import { sql, type RawBuilder } from "kysely";

export type ListMembershipStatus = "unconfirmed" | "confirmed" | "unsubscribed";

export interface SubscriberFilter {
  q?: string;
  // OR'd together: member of any of these lists. Paired with list_statuses
  // (when both given) as a single subscriber_lists condition -- list A +
  // status "unsubscribed" means "unsubscribed from A", not "unsubscribed
  // from *some* list while merely a member of A".
  list_ids?: number[];
  // OR'd together, scoped to list_ids when given, otherwise checked across
  // any list membership.
  list_statuses?: ListMembershipStatus[];
  // Global account status (subscribers.status), independent of any
  // particular list. OR'd against the list/status condition above rather
  // than AND'd -- "blocklisted" is a different axis (an account-wide state,
  // not a per-list one) and blocklisting already unsubscribes every
  // membership, so AND-ing it with a list filter would just hide blocklisted
  // subscribers behind whatever list condition was also selected.
  blocklisted?: boolean;
}

function listCondition(list_ids?: number[], list_statuses?: ListMembershipStatus[]) {
  const hasIds = !!list_ids?.length;
  const hasStatuses = !!list_statuses?.length;
  if (!hasIds && !hasStatuses) return undefined;
  const clauses: RawBuilder<boolean>[] = [];
  if (hasIds) clauses.push(sql<boolean>`list_id = ANY(${list_ids}::int[])`);
  if (hasStatuses) clauses.push(sql<boolean>`status = ANY(${list_statuses}::text[])`);
  return sql<boolean>`id IN (SELECT subscriber_id FROM subscriber_lists WHERE ${sql.join(clauses, sql` AND `)})`;
}

/** Combines the list/status condition and the blocklisted condition per the
 * OR semantics documented on SubscriberFilter.blocklisted -- shared between
 * the plain listing filter and the bulk-action selector so they can't
 * drift apart. */
function listOrBlocklistCondition(filter: SubscriberFilter): RawBuilder<boolean> | undefined {
  const membership = listCondition(filter.list_ids, filter.list_statuses);
  const blocklisted = filter.blocklisted ? sql<boolean>`status = 'blocklisted'` : undefined;
  if (membership && blocklisted) return sql<boolean>`(${membership} OR ${blocklisted})`;
  return membership ?? blocklisted;
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

  const { q } = selector.query;
  const conditions: RawBuilder<boolean>[] = [];
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(sql<boolean>`(email ilike ${pattern} OR name ilike ${pattern})`);
  }
  const listOrBlocklist = listOrBlocklistCondition(selector.query);
  if (listOrBlocklist) conditions.push(listOrBlocklist);

  if (conditions.length === 0) {
    // No filter at all -- "select all matching" with an empty query means
    // literally every subscriber.
    return sql<boolean>`subscribers.id IN (SELECT id FROM subscribers)`;
  }

  return sql<boolean>`subscribers.id IN (SELECT id FROM subscribers WHERE ${sql.join(conditions, sql` AND `)})`;
}
