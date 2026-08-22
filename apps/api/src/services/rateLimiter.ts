import { sql } from "kysely";
import type { DB } from "../db/kysely.js";

/**
 * Tables with a fixed-window rate-limit shape: `rate_limit_count` (null =
 * unlimited), `rate_limit_duration_seconds`, `window_start`, `window_count`.
 * Kept as an explicit allow-list (not a free-form string) even though it's
 * only used with `sql.id()` -- safe by construction, not by escaping.
 */
type RateLimitedTable = "connections" | "campaigns";

interface WindowRow {
  rate_limit_count: number | null;
  rate_limit_duration_seconds: number | null;
  window_start: Date | null;
  window_count: number;
}

/**
 * Atomically reserves up to `requested` send slots against a row's
 * fixed-window rate limit. Returns the number of slots actually granted (0
 * if the window is currently exhausted, up to `requested` otherwise).
 *
 * Shared by connections (the primary, provider-imposed limit, checked once
 * per send) and campaigns (an optional secondary cap, checked once per
 * dispatch batch to size how many recipients can be claimed this tick).
 * Enforced *globally* across every concurrent caller against the same row --
 * the check + increment run inside a real transaction that row-locks via
 * `SELECT ... FOR UPDATE`, so concurrent claimers serialize correctly and the
 * window counter can never be overrun (this must stay `db.transaction()`, not
 * `db.connection()` -- the latter doesn't hold the lock across statements).
 *
 * Null/<=0 `rate_limit_count` or `rate_limit_duration_seconds` means
 * unlimited -- `requested` is always granted without touching window state.
 */
export async function reserveRateLimitSlots(
  db: DB,
  table: RateLimitedTable,
  id: number,
  requested: number,
): Promise<number> {
  if (requested <= 0) return 0;

  return db.transaction().execute(async (trx) => {
    const result = await sql<WindowRow>`
      SELECT rate_limit_count, rate_limit_duration_seconds, window_start, window_count
      FROM ${sql.id(table)}
      WHERE id = ${id}
      FOR UPDATE
    `.execute(trx);
    const row = result.rows[0];

    if (!row) return requested; // row removed mid-send; let the sender fail naturally.

    const limit = row.rate_limit_count;
    const durSec = row.rate_limit_duration_seconds;
    if (!limit || !durSec || limit <= 0 || durSec <= 0) return requested; // unlimited.

    const now = new Date();
    const windowMs = durSec * 1000;
    const expired =
      !row.window_start || now.getTime() - new Date(row.window_start).getTime() >= windowMs;

    if (expired) {
      const granted = Math.min(requested, limit);
      await sql`
        UPDATE ${sql.id(table)} SET window_start = ${now}, window_count = ${granted} WHERE id = ${id}
      `.execute(trx);
      return granted;
    }

    const remaining = Math.max(0, limit - row.window_count);
    const granted = Math.min(requested, remaining);
    if (granted > 0) {
      await sql`
        UPDATE ${sql.id(table)} SET window_count = window_count + ${granted} WHERE id = ${id}
      `.execute(trx);
    }
    return granted;
  });
}

/** Connection-level check: one slot per actual send attempt. */
export async function tryAcquireSendSlot(db: DB, connectionId: number): Promise<boolean> {
  return (await reserveRateLimitSlots(db, "connections", connectionId, 1)) > 0;
}

/** Campaign-level check: reserves up to `requested` slots for one dispatch
 * batch/tick. A campaign with no rate limit set gets `requested` unconditionally. */
export async function reserveCampaignSendSlots(
  db: DB,
  campaignId: number,
  requested: number,
): Promise<number> {
  return reserveRateLimitSlots(db, "campaigns", campaignId, requested);
}
