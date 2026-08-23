import { sql } from "kysely";
import type { DB } from "../db/kysely.js";
import type { SubscriberFilter } from "./subscriberFilter.js";
import { selectorWhereClause } from "./subscriberFilter.js";
import { subscribersToCSV } from "../lib/csvSerialize.js";
import type { SubscriberRow } from "../lib/subscriberExport.js";

/**
 * Fetches subscriber rows (with their list memberships formatted as a
 * semicolon-separated `name:status` string) for CSV export, scoped by
 * the same selector the other bulk actions use.
 */
export async function exportSubscribers(
  db: DB,
  selector: { ids: number[] } | { query: SubscriberFilter; all: true },
): Promise<string> {
  const where = selectorWhereClause(selector);

  const rows = await sql<SubscriberRow>`
    WITH matching AS (
      SELECT id FROM subscribers WHERE ${where}
    )
    SELECT
      s.email,
      s.name,
      s.status::text AS status,
      s.attribs,
      COALESCE(
        (
          SELECT string_agg(l.name || ':' || sl.status::text, '; ')
          FROM subscriber_lists sl
          JOIN lists l ON l.id = sl.list_id
          WHERE sl.subscriber_id = s.id
        ),
        ''
      ) AS lists
    FROM subscribers s
    WHERE s.id IN (SELECT id FROM matching)
    ORDER BY s.id DESC
  `.execute(db);

  return subscribersToCSV(rows.rows);
}
