import type { DB } from "../db/kysely.js";
import type { BounceType } from "../db/types.js";
import { blocklistSubscriber } from "./subscribers.js";

// Hard bounces and spam complaints blocklist immediately; soft bounces just accumulate.
const HARD_BOUNCE_THRESHOLD = 1;
const COMPLAINT_THRESHOLD = 1;
const SOFT_BOUNCE_THRESHOLD = 5;

export interface RecordBounceInput {
  subscriberId: number;
  campaignId?: number | null;
  type: BounceType;
  source?: string;
  meta?: Record<string, unknown>;
  /** For sources that re-read the same event on every poll: a second record
   * with the same key is dropped, and does not count toward a threshold. */
  dedupeKey?: string;
}

/** Returns false when `dedupeKey` was already recorded and nothing changed. */
export async function recordBounce(db: DB, input: RecordBounceInput): Promise<boolean> {
  const inserted = await db
    .insertInto("bounces")
    .values({
      subscriber_id: input.subscriberId,
      campaign_id: input.campaignId ?? null,
      type: input.type,
      source: input.source ?? "",
      meta: input.meta ?? {},
      dedupe_key: input.dedupeKey ?? null,
    })
    .onConflict((oc) => oc.column("dedupe_key").doNothing())
    .returning("id")
    .executeTakeFirst();
  if (!inserted) return false;

  const { count } = await db
    .selectFrom("bounces")
    .select(db.fn.countAll().as("count"))
    .where("subscriber_id", "=", input.subscriberId)
    .where("type", "=", input.type)
    .executeTakeFirstOrThrow();

  const threshold =
    input.type === "hard"
      ? HARD_BOUNCE_THRESHOLD
      : input.type === "complaint"
        ? COMPLAINT_THRESHOLD
        : SOFT_BOUNCE_THRESHOLD;

  if (Number(count) >= threshold) {
    await blocklistSubscriber(db, input.subscriberId);
  }
  return true;
}

export interface RecordBounceByReferenceInput {
  /** The Message-ID we sent the mail with, angle brackets included. */
  messageId?: string | null;
  recipientEmail?: string | null;
  type: BounceType;
  source: string;
  meta?: Record<string, unknown>;
  dedupeKey?: string;
}

/** Resolves a bounce reported by a third party to a subscriber and records it:
 * Message-ID match first (exact subscriber + campaign), recipient address
 * second (subscriber only, campaign_id null). Neither matching is not an
 * error -- a shared mailbox or provider account carries plenty of mail that
 * isn't ours -- so it is silently dropped. */
export async function recordBounceByReference(
  db: DB,
  input: RecordBounceByReferenceInput,
): Promise<boolean> {
  const common = {
    type: input.type,
    source: input.source,
    meta: input.meta,
    dedupeKey: input.dedupeKey,
  };

  if (input.messageId) {
    const row = await db
      .selectFrom("campaign_emails")
      .select(["subscriber_id", "campaign_id"])
      .where("message_id", "=", input.messageId)
      .executeTakeFirst();
    if (row) {
      return recordBounce(db, {
        ...common,
        subscriberId: row.subscriber_id,
        campaignId: row.campaign_id,
      });
    }
  }

  if (input.recipientEmail) {
    const subscriber = await db
      .selectFrom("subscribers")
      .select("id")
      .where("email", "=", input.recipientEmail)
      .executeTakeFirst();
    if (subscriber) {
      return recordBounce(db, { ...common, subscriberId: subscriber.id, campaignId: null });
    }
  }

  return false;
}
