import { sql, type RawBuilder } from "kysely";

export interface SubscriberFilter {
  q?: string;
  list_id?: number;
}

/**
 * Builds a boolean SQL condition for a subscriber selector -- either an
 * explicit `id = ANY(...)` array match or a subquery re-running the same
 * filter the list page used (for "select all matching"). Used by the
 * bulk-action endpoints so each operates as one SQL statement, not a
 * per-row loop.
 *
 * Returns a Kysely `RawBuilder` (built via the `sql` tagged template, not a
 * hand-assembled `$1`/`$2` string) so it can be interpolated directly into
 * another `sql` template -- Kysely flattens and renumbers nested
 * placeholders automatically, correctly binding the actual parameter
 * values. A raw string + a separately-returned params array (the previous
 * shape here) only works if every caller manually re-threads those params
 * back into its own query, which none of them did -- every bulk endpoint
 * was silently executing with zero bound parameters and erroring.
 */
export function selectorWhereClause(
  selector: { ids: number[] } | { query: SubscriberFilter; all: true },
): RawBuilder<boolean> {
  if ("ids" in selector) {
    return sql<boolean>`subscribers.id = ANY(${selector.ids}::int[])`;
  }

  const { q, list_id } = selector.query;
  const conditions: RawBuilder<boolean>[] = [];
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(sql<boolean>`(email ilike ${pattern} OR name ilike ${pattern})`);
  }
  if (list_id) {
    conditions.push(
      sql<boolean>`id IN (SELECT subscriber_id FROM subscriber_lists WHERE list_id = ${list_id})`,
    );
  }

  if (conditions.length === 0) {
    // No filter at all -- "select all matching" with an empty query means
    // literally every subscriber.
    return sql<boolean>`subscribers.id IN (SELECT id FROM subscribers)`;
  }

  return sql<boolean>`subscribers.id IN (SELECT id FROM subscribers WHERE ${sql.join(conditions, sql` AND `)})`;
}
