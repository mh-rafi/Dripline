import { sql } from "kysely";
import type { DB } from "../db/kysely.js";
import { NotFoundError } from "../lib/errors.js";
import { triggerListJoined, triggerTagApplied } from "./workflows.js";

export async function getSubscriberOrThrow(db: DB, id: number) {
  const subscriber = await db
    .selectFrom("subscribers")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!subscriber) throw new NotFoundError("subscriber");
  return subscriber;
}

export async function addToList(
  db: DB,
  subscriberId: number,
  listId: number,
  status: "unconfirmed" | "confirmed" = "unconfirmed",
) {
  await db
    .insertInto("subscriber_lists")
    .values({ subscriber_id: subscriberId, list_id: listId, status })
    .onConflict((oc) => oc.columns(["subscriber_id", "list_id"]).doUpdateSet({ status }))
    .execute();

  await triggerListJoined(db, subscriberId, listId);
}

export async function removeFromList(db: DB, subscriberId: number, listId: number) {
  await db
    .updateTable("subscriber_lists")
    .set({ status: "unsubscribed" })
    .where("subscriber_id", "=", subscriberId)
    .where("list_id", "=", listId)
    .execute();
}

function getTags(attribs: Record<string, unknown>): string[] {
  const tags = attribs.tags;
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [];
}

export async function addTag(db: DB, subscriberId: number, tag: string) {
  const subscriber = await getSubscriberOrThrow(db, subscriberId);
  const tags = getTags(subscriber.attribs);
  if (!tags.includes(tag)) {
    const attribs = { ...subscriber.attribs, tags: [...tags, tag] };
    await db.updateTable("subscribers").set({ attribs }).where("id", "=", subscriberId).execute();
  }
  await triggerTagApplied(db, subscriberId, tag);
}

export async function removeTag(db: DB, subscriberId: number, tag: string) {
  const subscriber = await getSubscriberOrThrow(db, subscriberId);
  const tags = getTags(subscriber.attribs).filter((t) => t !== tag);
  const attribs = { ...subscriber.attribs, tags };
  await db.updateTable("subscribers").set({ attribs }).where("id", "=", subscriberId).execute();
}

export async function blocklistSubscriber(db: DB, subscriberId: number) {
  await db
    .updateTable("subscribers")
    .set({ status: "blocklisted" })
    .where("id", "=", subscriberId)
    .execute();
  await db
    .updateTable("subscriber_lists")
    .set({ status: "unsubscribed" })
    .where("subscriber_id", "=", subscriberId)
    .execute();
}

export async function unsubscribeFromCampaignLists(
  db: DB,
  subscriberId: number,
  campaignId: number,
) {
  await sql`
    UPDATE subscriber_lists sl
    SET status = 'unsubscribed'
    FROM campaign_lists cl
    WHERE cl.campaign_id = ${campaignId}
      AND sl.list_id = cl.list_id
      AND sl.subscriber_id = ${subscriberId}
  `.execute(db);
}
