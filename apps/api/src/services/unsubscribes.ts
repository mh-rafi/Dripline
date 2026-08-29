import type { DB } from "../db/kysely.js";
import type { UnsubscribeSource } from "../db/types.js";

/** Both campaign and automation unsubscribe links put a uuid in the same URL
 * slot -- automation emails reuse the campaign preference page (see
 * automations/actions.ts) -- so which of the two it is can only be settled by
 * looking it up in both tables. */
export async function resolveUnsubscribeOrigin(
  db: DB,
  uuid: string,
): Promise<{ campaignId: number | null; automationId: number | null }> {
  const campaign = await db
    .selectFrom("campaigns")
    .select("id")
    .where("uuid", "=", uuid)
    .executeTakeFirst();
  if (campaign) return { campaignId: campaign.id, automationId: null };

  const automation = await db
    .selectFrom("automations")
    .select("id")
    .where("uuid", "=", uuid)
    .executeTakeFirst();
  return { campaignId: null, automationId: automation?.id ?? null };
}

/**
 * Records one unsubscribe action. `listIds` is what the action actually
 * changed -- an empty array means nothing was left (a repeat click, or a
 * contact already unsubscribed), and nothing is recorded, so the metric counts
 * departures rather than requests.
 */
export async function recordUnsubscribe(
  db: DB,
  input: {
    subscriberId: number;
    campaignId?: number | null;
    automationId?: number | null;
    source: UnsubscribeSource;
    listIds: number[];
  },
): Promise<void> {
  if (input.listIds.length === 0) return;
  await db
    .insertInto("campaign_unsubscribes")
    .values({
      subscriber_id: input.subscriberId,
      campaign_id: input.campaignId ?? null,
      automation_id: input.automationId ?? null,
      source: input.source,
      list_ids: input.listIds,
    })
    .execute();
}

interface UnsubscribeCounts {
  unsubscribes: number;
  unique_unsubscribes: number;
}

async function countBy(
  db: DB,
  column: "campaign_id" | "automation_id",
  id: number,
): Promise<UnsubscribeCounts> {
  const row = await db
    .selectFrom("campaign_unsubscribes")
    .select((eb) => [
      eb.fn.countAll<string>().as("total"),
      eb.fn.count<string>("subscriber_id").distinct().as("unique"),
    ])
    .where(column, "=", id)
    .executeTakeFirst();
  return {
    unsubscribes: Number(row?.total ?? 0),
    unique_unsubscribes: Number(row?.unique ?? 0),
  };
}

export function getCampaignUnsubscribeCounts(db: DB, campaignId: number) {
  return countBy(db, "campaign_id", campaignId);
}

/** Each row carries `lists` -- names for the `list_ids` that still resolve. A
 * list deleted since the unsubscribe keeps its id in `list_ids` with no entry
 * in `lists`, so the UI can still say how many lists were left. */
async function listBy(
  db: DB,
  column: "campaign_id" | "automation_id",
  id: number,
  limit: number,
  offset: number,
) {
  const [rows, totalResult] = await Promise.all([
    db
      .selectFrom("campaign_unsubscribes")
      // Left join: subscriber_id goes null when a contact is deleted, and the
      // unsubscribe still happened.
      .leftJoin("subscribers", "subscribers.id", "campaign_unsubscribes.subscriber_id")
      .select([
        "campaign_unsubscribes.id",
        "campaign_unsubscribes.subscriber_id",
        "subscribers.email as subscriber_email",
        "subscribers.name as subscriber_name",
        "campaign_unsubscribes.source",
        "campaign_unsubscribes.list_ids",
        "campaign_unsubscribes.created_at",
      ])
      .where(column, "=", id)
      .orderBy("campaign_unsubscribes.id", "desc")
      .limit(limit)
      .offset(offset)
      .execute(),
    db
      .selectFrom("campaign_unsubscribes")
      .select(db.fn.countAll().as("count"))
      .where(column, "=", id)
      .executeTakeFirstOrThrow(),
  ]);

  // One lookup for every list named on this page, rather than a join that
  // would fan each unsubscribe out into one row per list.
  const referenced = [...new Set(rows.flatMap((r) => r.list_ids))];
  const lists = referenced.length
    ? await db.selectFrom("lists").select(["id", "name"]).where("id", "in", referenced).execute()
    : [];
  const byId = new Map(lists.map((l) => [l.id, l]));

  return {
    unsubscribes: rows.map((r) => ({
      ...r,
      lists: r.list_ids
        .map((lid) => byId.get(lid))
        .filter((l): l is { id: number; name: string } => l != null),
    })),
    total: Number(totalResult.count),
  };
}

export function listCampaignUnsubscribes(
  db: DB,
  campaignId: number,
  limit: number,
  offset: number,
) {
  return listBy(db, "campaign_id", campaignId, limit, offset);
}

export function listAutomationUnsubscribes(
  db: DB,
  automationId: number,
  limit: number,
  offset: number,
) {
  return listBy(db, "automation_id", automationId, limit, offset);
}

export function getAutomationUnsubscribeCounts(db: DB, automationId: number) {
  return countBy(db, "automation_id", automationId);
}
