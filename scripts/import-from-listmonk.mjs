#!/usr/bin/env node
// Imports subscribers, lists, and list memberships from an existing listmonk
// Postgres database into Dripline's. Read-only against the source DB.
//
// Usage:
//   LISTMONK_DATABASE_URL=postgres://... DRIPLINE_DATABASE_URL=postgres://... \
//     node scripts/import-from-listmonk.mjs
//
// Notes:
// - listmonk's `subscribers.status` (enabled/blocklisted) and
//   `subscriber_lists.status` (unconfirmed/confirmed/unsubscribed) map 1:1
//   onto Dripline's schema, so no transform is needed there.
// - Templates are NOT imported automatically: listmonk templates use Go's
//   html/template syntax ({{ .Subscriber.Name }}), Dripline uses Mustache
//   ({{ Subscriber.Name }}). Re-create templates by hand, adjusting syntax.
// - Campaigns are intentionally not imported -- this tool is for migrating
//   your audience, not campaign history.

import pg from "pg";

const sourceUrl = process.env.LISTMONK_DATABASE_URL;
const targetUrl = process.env.DRIPLINE_DATABASE_URL;

if (!sourceUrl || !targetUrl) {
  console.error("Set LISTMONK_DATABASE_URL and DRIPLINE_DATABASE_URL environment variables.");
  process.exit(1);
}

const source = new pg.Pool({ connectionString: sourceUrl });
const target = new pg.Pool({ connectionString: targetUrl });

async function main() {
  console.log("Importing lists...");
  const { rows: lists } = await source.query(`SELECT name, type, optin, description FROM lists`);
  const listIdMap = new Map(); // listmonk name -> dripline id

  for (const list of lists) {
    const { rows } = await target.query(
      `INSERT INTO lists (name, type, optin, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [list.name, list.type, list.optin, list.description ?? ""],
    );
    let id = rows[0]?.id;
    if (!id) {
      const existing = await target.query(`SELECT id FROM lists WHERE name = $1`, [list.name]);
      id = existing.rows[0]?.id;
    }
    if (id) listIdMap.set(list.name, id);
  }
  console.log(`  ${listIdMap.size} lists imported/matched.`);

  console.log("Importing subscribers (this may take a while for large lists)...");
  const BATCH = 1000;
  let offset = 0;
  let imported = 0;

  for (;;) {
    const { rows: subscribers } = await source.query(
      `SELECT id, email, name, attribs, status FROM subscribers ORDER BY id LIMIT $1 OFFSET $2`,
      [BATCH, offset],
    );
    if (subscribers.length === 0) break;

    for (const s of subscribers) {
      const { rows } = await target.query(
        `INSERT INTO subscribers (email, name, attribs, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [s.email, s.name ?? "", s.attribs ?? {}, s.status],
      );
      const driplineId = rows[0].id;

      const { rows: memberships } = await source.query(
        `SELECT l.name, sl.status FROM subscriber_lists sl
         JOIN lists l ON l.id = sl.list_id WHERE sl.subscriber_id = $1`,
        [s.id],
      );
      for (const m of memberships) {
        const listId = listIdMap.get(m.name);
        if (!listId) continue;
        await target.query(
          `INSERT INTO subscriber_lists (subscriber_id, list_id, status)
           VALUES ($1, $2, $3)
           ON CONFLICT (subscriber_id, list_id) DO UPDATE SET status = EXCLUDED.status`,
          [driplineId, listId, m.status],
        );
      }
      imported++;
    }

    offset += BATCH;
    console.log(`  ${imported} subscribers imported so far...`);
  }

  console.log(`Done. ${imported} subscribers imported across ${listIdMap.size} lists.`);
  console.log("Reminder: templates and campaigns were not imported -- see script header.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await source.end();
    await target.end();
  });
