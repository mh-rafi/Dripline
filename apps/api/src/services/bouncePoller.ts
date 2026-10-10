import type { DB } from "../db/kysely.js";
import type { BouncePollConfig } from "../db/types.js";
import { getBounceProvider } from "../bounceProviders/index.js";
import { recordBounceByReference } from "./bounces.js";

// A broken API key or an unreachable provider auto-disables polling for that
// connection after this many consecutive failures, mirroring the mailbox
// scanner -- and like it, never touches sending.
const MAX_CONSECUTIVE_ERRORS = 5;

async function recordPollError(db: DB, connectionId: number, err: unknown): Promise<void> {
  const conn = await db
    .selectFrom("connections")
    .select(["bounce_poll_error_count", "bounce_poll_config"])
    .where("id", "=", connectionId)
    .executeTakeFirst();
  if (!conn) return;
  const errorCount = conn.bounce_poll_error_count + 1;
  const message = err instanceof Error ? err.message : String(err);
  const shouldDisable = errorCount >= MAX_CONSECUTIVE_ERRORS && conn.bounce_poll_config;

  await db
    .updateTable("connections")
    .set({
      bounce_poll_error_count: errorCount,
      bounce_poll_disabled_reason: `${message} (${errorCount} consecutive failures)`,
      bounce_poll_last_run_at: new Date(),
      ...(shouldDisable
        ? { bounce_poll_config: { ...conn.bounce_poll_config!, enabled: false } }
        : {}),
    })
    .where("id", "=", connectionId)
    .execute();
}

/** Reads one connection's provider delivery log and records every definite
 * failure in it via recordBounceByReference() -- the same Message-ID-then-
 * address resolution, thresholds and auto-blocklisting the webhook and
 * mailbox-scan paths use.
 *
 * The same window is re-read every tick rather than tracked with a cursor: a
 * log row's status changes in place (queued, then failed), so a cursor would
 * walk past a message that hadn't failed yet. bounces.dedupe_key is what
 * makes the re-read harmless. */
export async function pollConnectionForBounces(db: DB, connectionId: number): Promise<void> {
  const connection = await db
    .selectFrom("connections")
    .select(["id", "bounce_poll_config"])
    .where("id", "=", connectionId)
    .executeTakeFirst();
  const config: BouncePollConfig | null = connection?.bounce_poll_config ?? null;
  if (!config?.enabled) return;

  const provider = getBounceProvider(config.provider);
  if (!provider) {
    await recordPollError(db, connectionId, new Error(`unknown provider "${config.provider}"`));
    return;
  }

  try {
    const since = new Date(Date.now() - config.lookback_days * 24 * 60 * 60 * 1000);
    const failures = await provider.fetchFailures({ settings: config.settings, since });
    for (const failure of failures) {
      await recordBounceByReference(db, {
        messageId: failure.messageId,
        recipientEmail: failure.recipient,
        type: failure.type,
        source: `api-poll:${provider.key}`,
        meta: { connection_id: connectionId, detail: failure.detail },
        dedupeKey: `${connectionId}:${failure.key}`,
      });
    }
    await db
      .updateTable("connections")
      .set({
        bounce_poll_error_count: 0,
        bounce_poll_disabled_reason: null,
        bounce_poll_last_run_at: new Date(),
      })
      .where("id", "=", connectionId)
      .execute();
  } catch (err) {
    await recordPollError(db, connectionId, err);
  }
}
