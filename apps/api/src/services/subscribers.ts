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

/**
 * Adds a subscriber to a list. If `status` isn't given explicitly, it
 * defaults based on the list's opt-in type: `confirmed` for single opt-in
 * (where "unconfirmed" would be a meaningless, confusing default -- single
 * opt-in members are always eligible to receive campaigns regardless of this
 * status), `unconfirmed` for double opt-in (where it's a real gate: only
 * `confirmed` subscribers on a double opt-in list receive campaigns -- see
 * queries/campaigns.ts eligibility logic). Callers can still force a status
 * explicitly (e.g. an admin manually marking someone confirmed).
 */
export async function addToList(
  db: DB,
  subscriberId: number,
  listId: number,
  status?: "unconfirmed" | "confirmed",
) {
  const resolvedStatus = status ?? (await defaultStatusForList(db, listId));

  await db
    .insertInto("subscriber_lists")
    .values({ subscriber_id: subscriberId, list_id: listId, status: resolvedStatus })
    .onConflict((oc) =>
      oc.columns(["subscriber_id", "list_id"]).doUpdateSet({ status: resolvedStatus }),
    )
    .execute();

  await triggerListJoined(db, subscriberId, listId);
}

/**
 * Import-specific variant of addToList: the caller always passes an explicit
 * status (no opt-in-type default guessing -- the import form asks for it up
 * front), and `overwriteStatus` controls whether an existing membership's
 * status gets clobbered or left alone, matching the "Overwrite subscription
 * status" toggle in the import UI.
 */
export async function addToListForImport(
  db: DB,
  subscriberId: number,
  listId: number,
  status: "unconfirmed" | "confirmed",
  overwriteStatus: boolean,
) {
  const query = db
    .insertInto("subscriber_lists")
    .values({ subscriber_id: subscriberId, list_id: listId, status });
  await (
    overwriteStatus
      ? query.onConflict((oc) => oc.columns(["subscriber_id", "list_id"]).doUpdateSet({ status }))
      : query.onConflict((oc) => oc.columns(["subscriber_id", "list_id"]).doNothing())
  ).execute();
  await triggerListJoined(db, subscriberId, listId);
}

async function defaultStatusForList(db: DB, listId: number): Promise<"unconfirmed" | "confirmed"> {
  const list = await db
    .selectFrom("lists")
    .select("optin")
    .where("id", "=", listId)
    .executeTakeFirst();
  return list?.optin === "double" ? "unconfirmed" : "confirmed";
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

/**
 * Reverses a blocklist -- makes the subscriber eligible for sends again.
 * Deliberately does *not* restore their list memberships to unsubscribed's
 * prior status: blocklisting unsubscribed them from everything, and silently
 * re-subscribing on un-blocklist would resurrect consent that was
 * intentionally withdrawn (or lost to a hard bounce) without them asking for
 * it. An admin can re-add them to specific lists explicitly if appropriate.
 */
export async function unblocklistSubscriber(db: DB, subscriberId: number) {
  await db
    .updateTable("subscribers")
    .set({ status: "enabled" })
    .where("id", "=", subscriberId)
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
