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
}

export async function recordBounce(db: DB, input: RecordBounceInput): Promise<void> {
  await db
    .insertInto("bounces")
    .values({
      subscriber_id: input.subscriberId,
      campaign_id: input.campaignId ?? null,
      type: input.type,
      source: input.source ?? "",
      meta: input.meta ?? {},
    })
    .execute();

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
}
