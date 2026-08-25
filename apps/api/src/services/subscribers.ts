import { sql } from "kysely";
import type { DB } from "../db/kysely.js";
import { NotFoundError } from "../lib/errors.js";
import { fireEvent } from "./automations.js";

export async function getSubscriberOrThrow(db: DB, id: number) {
  const subscriber = await db
    .selectFrom("subscribers")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!subscriber) throw new NotFoundError("subscriber");
  return subscriber;
}

export interface CreateSubscriberInput {
  email: string;
  name?: string;
  attribs?: Record<string, unknown>;
}

/**
 * Upserts a contact by email and fires `contact_created` only when the row is
 * genuinely new. Every path that can introduce a contact (admin create, CSV
 * import, automation webhook) goes through here or reports creation itself, so
 * the trigger can't fire twice for one person.
 */
export async function createSubscriber(db: DB, input: CreateSubscriberInput) {
  const existing = await db
    .selectFrom("subscribers")
    .selectAll()
    .where("email", "=", input.email)
    .executeTakeFirst();

  if (existing) {
    if (input.name === undefined && input.attribs === undefined) return existing;
    return db
      .updateTable("subscribers")
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.attribs !== undefined ? { attribs: input.attribs } : {}),
      })
      .where("id", "=", existing.id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  const subscriber = await db
    .insertInto("subscribers")
    .values({ email: input.email, name: input.name ?? "", attribs: input.attribs ?? {} })
    .returningAll()
    .executeTakeFirstOrThrow();

  await fireEvent(db, { type: "contact_created", subscriberId: subscriber.id, data: {} });
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
      // Clearing pre_blocklist_status here too: an explicit status change
      // supersedes whatever blocklisting had stashed, so a later unblock
      // doesn't clobber it back.
      oc
        .columns(["subscriber_id", "list_id"])
        .doUpdateSet({ status: resolvedStatus, pre_blocklist_status: null }),
    )
    .execute();

  await fireEvent(db, { type: "list_applied", subscriberId, data: { listId } });
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
      ? query.onConflict((oc) =>
          oc
            .columns(["subscriber_id", "list_id"])
            .doUpdateSet({ status, pre_blocklist_status: null }),
        )
      : query.onConflict((oc) => oc.columns(["subscriber_id", "list_id"]).doNothing())
  ).execute();
  await fireEvent(db, { type: "list_applied", subscriberId, data: { listId } });
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
    // An explicit removal wins over whatever blocklisting had stashed --
    // don't let a later unblock resurrect a membership someone deliberately
    // removed in the meantime.
    .set({ status: "unsubscribed", pre_blocklist_status: null })
    .where("subscriber_id", "=", subscriberId)
    .where("list_id", "=", listId)
    .execute();

  await fireEvent(db, { type: "list_removed", subscriberId, data: { listId } });
}

/**
 * Self-service unsubscribe from specific lists (the unsubscribe preference
 * page). Restricted to public lists -- a private list's id should never
 * reach here since the page never shows one as a checkbox, but the query
 * still enforces it server-side rather than trusting the submitted ids.
 */
export async function unsubscribeFromLists(db: DB, subscriberId: number, listIds: number[]) {
  if (listIds.length === 0) return;
  await db
    .updateTable("subscriber_lists")
    .set({ status: "unsubscribed", pre_blocklist_status: null })
    .where("subscriber_id", "=", subscriberId)
    .where("list_id", "in", listIds)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("lists")
          .select("id")
          .whereRef("lists.id", "=", "subscriber_lists.list_id")
          .where("lists.type", "=", "public"),
      ),
    )
    .execute();
}

/**
 * Self-service "unsubscribe from everything" -- unlike unsubscribeFromLists,
 * this also covers private lists (the only way to leave one, since it's
 * never shown as an individual choice) but stops short of blocklisting: the
 * subscriber can still be re-added to a list later, unlike a blocklisted
 * record.
 */
export async function unsubscribeFromAllLists(db: DB, subscriberId: number) {
  await db
    .updateTable("subscriber_lists")
    .set({ status: "unsubscribed", pre_blocklist_status: null })
    .where("subscriber_id", "=", subscriberId)
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
}

export async function removeTag(db: DB, subscriberId: number, tag: string) {
  const subscriber = await getSubscriberOrThrow(db, subscriberId);
  const tags = getTags(subscriber.attribs).filter((t) => t !== tag);
  const attribs = { ...subscriber.attribs, tags };
  await db.updateTable("subscribers").set({ attribs }).where("id", "=", subscriberId).execute();
}

/**
 * Blocklists a subscriber and force-unsubscribes them from every list.
 * Before overwriting each membership's status, stashes it in
 * `pre_blocklist_status` (skipping memberships already unsubscribed -- those
 * weren't unsubscribed *by* this blocklisting, so there's nothing of theirs
 * to remember) so unblocklistSubscriber() can undo exactly this side effect
 * later, without resurrecting a genuine prior opt-out.
 */
export async function blocklistSubscriber(db: DB, subscriberId: number) {
  await db
    .updateTable("subscribers")
    .set({ status: "blocklisted" })
    .where("id", "=", subscriberId)
    .execute();
  await sql`
    UPDATE subscriber_lists
    SET pre_blocklist_status = status, status = 'unsubscribed'
    WHERE subscriber_id = ${subscriberId} AND status != 'unsubscribed'
  `.execute(db);
}

/**
 * Reverses a blocklist -- makes the subscriber eligible for sends again, and
 * restores exactly the list memberships blocklistSubscriber() force-
 * unsubscribed (via `pre_blocklist_status`, cleared once restored). A
 * membership the subscriber had already unsubscribed from themselves before
 * ever being blocklisted is left alone, since it was never touched by
 * blocklisting in the first place.
 */
export async function unblocklistSubscriber(db: DB, subscriberId: number) {
  await db
    .updateTable("subscribers")
    .set({ status: "enabled" })
    .where("id", "=", subscriberId)
    .execute();
  await sql`
    UPDATE subscriber_lists
    SET status = pre_blocklist_status, pre_blocklist_status = NULL
    WHERE subscriber_id = ${subscriberId} AND pre_blocklist_status IS NOT NULL
  `.execute(db);
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
