import { sql } from "kysely";
import type { DB } from "../db/kysely.js";
import type { SubscriberFilter } from "./subscriberFilter.js";
import { selectorWhereClause } from "./subscriberFilter.js";
import { fireEvent } from "./automations.js";

type BulkSelector = { ids: number[] } | { query: SubscriberFilter; all: true };

/**
 * Bulk blocklist: sets `subscribers.status = 'blocklisted'` and force-
 * unsubscribes every matching `subscriber_lists` row, stashing the prior
 * status in `pre_blocklist_status`. One SQL statement each — not a
 * per-row loop.
 */
export async function bulkBlocklist(db: DB, selector: BulkSelector): Promise<number> {
  const where = selectorWhereClause(selector);

  const subscriberResult = await sql<{ affected: number }>`
    WITH matching AS (
      SELECT id FROM subscribers WHERE ${where}
    ),
    updated AS (
      UPDATE subscribers SET status = 'blocklisted'
      WHERE id IN (SELECT id FROM matching)
      RETURNING 1
    )
    SELECT COUNT(*)::int AS affected FROM updated
  `.execute(db);

  await sql`
    WITH matching AS (
      SELECT id FROM subscribers WHERE ${where}
    )
    UPDATE subscriber_lists
    SET pre_blocklist_status = status, status = 'unsubscribed'
    WHERE subscriber_id IN (SELECT id FROM matching)
      AND status != 'unsubscribed'
  `.execute(db);

  return subscriberResult.rows[0]?.affected ?? 0;
}

/**
 * Bulk delete: `DELETE FROM subscribers WHERE ...`, relying on existing
 * ON DELETE CASCADE foreign keys for cleanup.
 */
export async function bulkDelete(db: DB, selector: BulkSelector): Promise<number> {
  const where = selectorWhereClause(selector);

  const result = await sql<{ affected: number }>`
    WITH matching AS (
      SELECT id FROM subscribers WHERE ${where}
    ),
    deleted AS (
      DELETE FROM subscribers WHERE id IN (SELECT id FROM matching) RETURNING 1
    )
    SELECT COUNT(*)::int AS affected FROM deleted
  `.execute(db);

  return result.rows[0]?.affected ?? 0;
}

/**
 * Bulk list management: add-to or remove-from lists for every subscriber
 * matching the selector. One SQL statement per action — not a per-row
 * loop.
 *
 * Automation triggers (`list_applied` / `list_removed`) are opt-in per call
 * and default to off: firing them for potentially thousands of rows from one
 * bulk admin action would flood enrollments, so the caller (the bulk dialog)
 * has to ask for it deliberately.
 */
export interface BulkListsOptions {
  status?: "unconfirmed" | "confirmed";
  /** Enrol the affected contacts in automations listening for this change. */
  triggerAutomations?: boolean;
}

export async function bulkLists(
  db: DB,
  selector: BulkSelector,
  listIds: number[],
  action: "add" | "remove",
  options: BulkListsOptions = {},
): Promise<number> {
  const { status, triggerAutomations = false } = options;
  const where = selectorWhereClause(selector);

  if (action === "add") {
    // Returning the affected pairs (rather than a bare count) is what lets a
    // bulk change fire the same automation triggers a single-contact change
    // does -- see docs/plan/automations_v2.md.
    const result = await sql<Membership>`
      WITH matching AS (
        SELECT id FROM subscribers WHERE ${where}
      )
      INSERT INTO subscriber_lists (subscriber_id, list_id, status)
      SELECT m.id, l.list_id, ${status ?? "confirmed"}::text
      FROM matching m
      CROSS JOIN unnest(${listIds}::int[]) AS l(list_id)
      ON CONFLICT (subscriber_id, list_id)
      DO UPDATE SET status = excluded.status, pre_blocklist_status = NULL
      RETURNING subscriber_id, list_id
    `.execute(db);

    if (triggerAutomations) await fireMembershipEvents(db, "list_applied", result.rows);
    return result.rows.length;
  }

  // action === "remove" — soft-unsubscribe matching memberships.
  const result = await sql<Membership>`
    WITH matching AS (
      SELECT id FROM subscribers WHERE ${where}
    )
    UPDATE subscriber_lists
    SET status = 'unsubscribed', pre_blocklist_status = NULL
    WHERE subscriber_id IN (SELECT id FROM matching)
      AND list_id = ANY(${listIds}::int[])
    RETURNING subscriber_id, list_id
  `.execute(db);

  if (triggerAutomations) await fireMembershipEvents(db, "list_removed", result.rows);
  return result.rows.length;
}

interface Membership {
  subscriber_id: number;
  list_id: number;
}

async function fireMembershipEvents(
  db: DB,
  type: "list_applied" | "list_removed",
  rows: Membership[],
): Promise<void> {
  for (const row of rows) {
    await fireEvent(db, {
      type,
      subscriberId: row.subscriber_id,
      data: { listId: row.list_id },
    });
  }
}
