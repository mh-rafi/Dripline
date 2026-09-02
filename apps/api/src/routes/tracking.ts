import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import type { Config } from "../config.js";
import { verify } from "../lib/signing.js";
import { decodeId } from "../lib/shortId.js";
import { parseUnsubscribeRef, verifyTrackingSig } from "../lib/trackingUrls.js";
import { TRANSPARENT_GIF } from "../lib/pixel.js";
import { recordEvent } from "../services/automations.js";
import {
  unsubscribeFromAllLists,
  unsubscribeFromCampaignLists,
  unsubscribeFromLists,
} from "../services/subscribers.js";
import {
  recordUnsubscribe,
  resolveUnsubscribeOrigin,
  setUnsubscribeReason,
} from "../services/unsubscribes.js";
import { ReasonBody } from "../lib/unsubscribeReasons.js";

const Params = z.object({ campaignUuid: z.string().uuid(), subscriberUuid: z.string().uuid() });

async function resolveIds(db: DB, campaignUuid: string, subscriberUuid: string) {
  const campaign = await db
    .selectFrom("campaigns")
    .select(["id"])
    .where("uuid", "=", campaignUuid)
    .executeTakeFirst();
  const subscriber = await db
    .selectFrom("subscribers")
    .select(["id"])
    .where("uuid", "=", subscriberUuid)
    .executeTakeFirst();
  return { campaignId: campaign?.id ?? null, subscriberId: subscriber?.id ?? null };
}

const ShortClickParams = z.object({
  c: z.string().min(1).max(9),
  s: z.string().min(1).max(9),
  k: z.string().min(1).max(9),
  sig: z.string().length(16),
});

const ShortOpenParams = ShortClickParams.omit({ k: true });

const AutomationClickParams = z.object({
  e: z.string().min(1).max(9),
  s: z.string().min(1).max(9),
  k: z.string().min(1).max(9),
  sig: z.string().length(16),
});

const AutomationOpenParams = AutomationClickParams.omit({ k: true });

const ShortUnsubParams = z.object({
  ref: z.string().min(2).max(10),
  s: z.string().min(1).max(9),
  sig: z.string().length(16),
});

type ShortUnsubLink = { kind: "campaign" | "automation"; id: number; subscriberId: number };

/** Resolves the three segments of a short unsubscribe URL and verifies its
 * signature. Null means it isn't a link this install issued. */
function parseShortUnsub(config: Config, params: unknown): ShortUnsubLink | null {
  const { ref, s, sig } = ShortUnsubParams.parse(params);
  if (!verifyTrackingSig(config, ["u", ref, s], sig)) return null;
  const parsed = parseUnsubscribeRef(ref);
  const subscriberId = decodeId(s);
  if (!parsed || subscriberId === null || subscriberId <= 0) return null;
  return { ...parsed, subscriberId };
}

function originOf(link: ShortUnsubLink) {
  return link.kind === "campaign"
    ? { campaignId: link.id, automationId: null }
    : { campaignId: null, automationId: link.id };
}

/** The lists an unsubscribe page offers: public ones the contact hasn't
 * already left. */
function publicListsFor(db: DB, subscriberId: number) {
  return db
    .selectFrom("subscriber_lists")
    .innerJoin("lists", "lists.id", "subscriber_lists.list_id")
    .select(["lists.id", "lists.name"])
    .where("subscriber_lists.subscriber_id", "=", subscriberId)
    .where("lists.type", "=", "public")
    .where("subscriber_lists.status", "!=", "unsubscribed")
    .execute();
}

/**
 * Best-effort click recording. The ids come straight off the URL rather than
 * from a lookup, so a campaign or subscriber deleted between the send and the
 * click would fail the insert's foreign key -- and a reader owed a redirect
 * should never be handed a 500 because the analytics write didn't land.
 */
async function recordClick(
  db: DB,
  click: { linkId: number; campaignId: number; subscriberId: number; url: string },
): Promise<void> {
  const { linkId, campaignId, subscriberId, url } = click;
  try {
    if (campaignId > 0) {
      await db
        .insertInto("link_clicks")
        .values({
          link_id: linkId,
          campaign_id: campaignId,
          subscriber_id: subscriberId > 0 ? subscriberId : null,
        })
        .execute();
    }
    if (subscriberId > 0) {
      await recordEvent(db, {
        source: "link_clicked",
        eventKey: url,
        subscriberId,
        payload: { url, campaignId },
      });
    }
  } catch (err) {
    console.error(`click tracking failed for link ${linkId}: ${String(err)}`);
  }
}

async function recordAutomationClick(
  db: DB,
  click: { linkId: number; emailNodeId: number; subscriberId: number; url: string },
): Promise<void> {
  const { linkId, emailNodeId, subscriberId, url } = click;
  try {
    await db
      .insertInto("automation_link_clicks")
      .values({
        email_node_id: emailNodeId,
        link_id: linkId,
        subscriber_id: subscriberId > 0 ? subscriberId : null,
      })
      .execute();
    if (subscriberId > 0) {
      await recordEvent(db, {
        source: "link_clicked",
        eventKey: url,
        subscriberId,
        payload: { url, automationEmailNodeId: emailNodeId },
      });
    }
  } catch (err) {
    console.error(`automation click tracking failed for link ${linkId}: ${String(err)}`);
  }
}

export default async function trackingRoutes(
  app: FastifyInstance,
  opts: { db: DB; config: Config },
) {
  const { db, config } = opts;

  // ---- short tracking URLs ---------------------------------------------------
  // What newly sent mail carries. The uuid-based /api/v1/track/* and
  // /unsubscribe/* routes below are the older shape and have to keep working
  // for as long as mail carrying them can still sit in someone's inbox.
  // See lib/trackingUrls.ts for why they got shorter.

  app.get("/l/:c/:s/:k/:sig", async (req, reply) => {
    const { c, s, k, sig } = ShortClickParams.parse(req.params);
    const linkId = decodeId(k);
    if (linkId === null) return reply.code(404).send({ error: "not found" });

    const link = await db
      .selectFrom("links")
      .select("url")
      .where("id", "=", linkId)
      .executeTakeFirst();
    if (!link) return reply.code(404).send({ error: "not found" });

    // A bad signature still redirects, matching the older route: a mail client
    // that rewrote the URL shouldn't leave the reader at a dead end. It just
    // doesn't get counted.
    if (verifyTrackingSig(config, ["l", c, s, k], sig)) {
      await recordClick(db, {
        linkId,
        campaignId: decodeId(c) ?? 0,
        subscriberId: decodeId(s) ?? 0,
        url: link.url,
      });
    }
    return reply.redirect(link.url);
  });

  app.get("/o/:c/:s/:sig", async (req, reply) => {
    const { c, s, sig } = ShortOpenParams.parse(req.params);

    reply.header("content-type", "image/gif");
    if (!verifyTrackingSig(config, ["o", c, s], sig)) {
      return reply.send(TRANSPARENT_GIF);
    }

    // Id 0 is the synthetic campaign/subscriber a preview renders against --
    // never a real row, so there is nothing to record.
    const campaignId = decodeId(c) ?? 0;
    const subscriberId = decodeId(s) ?? 0;
    if (campaignId > 0) {
      try {
        await db
          .insertInto("campaign_views")
          .values({
            campaign_id: campaignId,
            subscriber_id: subscriberId > 0 ? subscriberId : null,
          })
          .execute();
      } catch (err) {
        console.error(`open tracking failed for campaign ${campaignId}: ${String(err)}`);
      }
    }
    return reply.send(TRANSPARENT_GIF);
  });

  /** Automation click. `e` is an automation_email_nodes id, so a click is
   * attributed to the exact step that sent the mail rather than to the whole
   * automation. Mirrors /l/ otherwise, including redirecting on a bad
   * signature. */
  app.get("/al/:e/:s/:k/:sig", async (req, reply) => {
    const { e, s, k, sig } = AutomationClickParams.parse(req.params);
    const linkId = decodeId(k);
    if (linkId === null) return reply.code(404).send({ error: "not found" });

    const link = await db
      .selectFrom("links")
      .select("url")
      .where("id", "=", linkId)
      .executeTakeFirst();
    if (!link) return reply.code(404).send({ error: "not found" });

    const emailNodeId = decodeId(e) ?? 0;
    if (emailNodeId > 0 && verifyTrackingSig(config, ["al", e, s, k], sig)) {
      await recordAutomationClick(db, {
        linkId,
        emailNodeId,
        subscriberId: decodeId(s) ?? 0,
        url: link.url,
      });
    }
    return reply.redirect(link.url);
  });

  /** Automation open pixel. */
  app.get("/ao/:e/:s/:sig", async (req, reply) => {
    const { e, s, sig } = AutomationOpenParams.parse(req.params);

    reply.header("content-type", "image/gif");
    if (!verifyTrackingSig(config, ["ao", e, s], sig)) {
      return reply.send(TRANSPARENT_GIF);
    }

    const emailNodeId = decodeId(e) ?? 0;
    const subscriberId = decodeId(s) ?? 0;
    if (emailNodeId > 0) {
      try {
        await db
          .insertInto("automation_views")
          .values({
            email_node_id: emailNodeId,
            subscriber_id: subscriberId > 0 ? subscriberId : null,
          })
          .execute();
      } catch (err) {
        console.error(`open tracking failed for automation node ${emailNodeId}: ${String(err)}`);
      }
    }
    return reply.send(TRANSPARENT_GIF);
  });

  /** One-click (RFC 8058) target for the List-Unsubscribe header. A campaign
   * unsubscribe leaves the lists it was sent through; an automation isn't
   * list-scoped that way, so the honest equivalent there is leaving
   * everything. */
  app.all("/api/v1/u/:ref/:s/:sig", async (req, reply) => {
    const link = parseShortUnsub(config, req.params);
    if (!link) return reply.code(403).send({ error: "invalid unsubscribe link" });

    const listIds =
      link.kind === "campaign"
        ? await unsubscribeFromCampaignLists(db, link.subscriberId, link.id)
        : await unsubscribeFromAllLists(db, link.subscriberId);
    await recordUnsubscribe(db, {
      subscriberId: link.subscriberId,
      ...originOf(link),
      source: "one_click",
      listIds,
    });
    return { ok: true };
  });

  app.get("/api/v1/u/:ref/:s/:sig/lists", async (req, reply) => {
    const link = parseShortUnsub(config, req.params);
    if (!link) return reply.code(403).send({ error: "invalid unsubscribe link" });

    const subscriber = await db
      .selectFrom("subscribers")
      .select(["id", "email"])
      .where("id", "=", link.subscriberId)
      .executeTakeFirst();
    if (!subscriber) return reply.code(404).send({ error: "not found" });

    return { email: subscriber.email, lists: await publicListsFor(db, subscriber.id) };
  });

  app.post("/api/v1/u/:ref/:s/:sig/lists", async (req, reply) => {
    const link = parseShortUnsub(config, req.params);
    if (!link) return reply.code(403).send({ error: "invalid unsubscribe link" });
    const { list_ids } = z.object({ list_ids: z.array(z.number().int()) }).parse(req.body);

    const changed = await unsubscribeFromLists(db, link.subscriberId, list_ids);
    // The id goes back so the page can offer the optional "why did you leave"
    // question afterwards -- null when nothing changed (a repeat click), in
    // which case there is no row to attach anything to.
    const unsubscribe_id = await recordUnsubscribe(db, {
      subscriberId: link.subscriberId,
      ...originOf(link),
      source: "preferences",
      listIds: changed,
    });
    return { ok: true, unsubscribe_id };
  });

  app.post("/api/v1/u/:ref/:s/:sig/all", async (req, reply) => {
    const link = parseShortUnsub(config, req.params);
    if (!link) return reply.code(403).send({ error: "invalid unsubscribe link" });

    const listIds = await unsubscribeFromAllLists(db, link.subscriberId);
    const unsubscribe_id = await recordUnsubscribe(db, {
      subscriberId: link.subscriberId,
      ...originOf(link),
      source: "all",
      listIds,
    });
    return { ok: true, unsubscribe_id };
  });

  /** Optional feedback on an unsubscribe that has already happened -- the page
   * asks only after the fact, so this can never gate or delay someone
   * leaving. Silently a no-op if the row is already answered or isn't this
   * contact's: there is nothing useful to tell a departing reader either way. */
  app.post("/api/v1/u/:ref/:s/:sig/reason", async (req, reply) => {
    const link = parseShortUnsub(config, req.params);
    if (!link) return reply.code(403).send({ error: "invalid unsubscribe link" });
    const body = ReasonBody.parse(req.body);

    await setUnsubscribeReason(db, {
      unsubscribeId: body.unsubscribe_id,
      subscriberId: link.subscriberId,
      reason: body.reason,
      comment: body.comment,
    });
    return { ok: true };
  });

  // ---- legacy uuid-based tracking URLs ---------------------------------------

  app.get("/api/v1/track/open/:campaignUuid/:subscriberUuid", async (req, reply) => {
    const { campaignUuid, subscriberUuid } = Params.parse(req.params);
    const { sig } = z.object({ sig: z.string() }).parse(req.query);

    reply.header("content-type", "image/gif");
    if (!verify(config.trackingSecret, [subscriberUuid, campaignUuid, "open"], sig)) {
      return reply.send(TRANSPARENT_GIF);
    }

    const { campaignId, subscriberId } = await resolveIds(db, campaignUuid, subscriberUuid);
    if (campaignId) {
      await db
        .insertInto("campaign_views")
        .values({ campaign_id: campaignId, subscriber_id: subscriberId })
        .execute();
    }
    return reply.send(TRANSPARENT_GIF);
  });

  app.get("/api/v1/track/click/:campaignUuid/:subscriberUuid", async (req, reply) => {
    const { campaignUuid, subscriberUuid } = Params.parse(req.params);
    const { url, sig } = z.object({ url: z.string().url(), sig: z.string() }).parse(req.query);

    if (!verify(config.trackingSecret, [subscriberUuid, campaignUuid, url], sig)) {
      return reply.redirect(url);
    }

    const { campaignId, subscriberId } = await resolveIds(db, campaignUuid, subscriberUuid);
    const link = await db
      .insertInto("links")
      .values({ url })
      .onConflict((oc) => oc.column("url").doUpdateSet({ url }))
      .returning("id")
      .executeTakeFirst();

    if (link && campaignId) {
      await db
        .insertInto("link_clicks")
        .values({ link_id: link.id, campaign_id: campaignId, subscriber_id: subscriberId })
        .execute();
    }
    if (subscriberId) {
      await recordEvent(db, {
        source: "link_clicked",
        eventKey: url,
        subscriberId,
        payload: { url, campaignId },
      });
    }

    return reply.redirect(url);
  });

  /** One-click (RFC 8058) target for automation emails. Automations aren't
   * list-scoped the way a campaign is, so there is no "the lists this was sent
   * through" to leave -- the honest equivalent of one-click here is leaving
   * everything. The visible link in the body goes to the preference page
   * instead, which offers per-list choice. */
  app.all("/api/v1/unsubscribe/automation/:automationUuid/:subscriberUuid", async (req, reply) => {
    const { automationUuid, subscriberUuid } = z
      .object({ automationUuid: z.string().uuid(), subscriberUuid: z.string().uuid() })
      .parse(req.params);
    const { sig } = z
      .object({ sig: z.string() })
      .parse({ ...(req.query as object), ...(req.body as object) });

    if (!verify(config.trackingSecret, [subscriberUuid, automationUuid], sig)) {
      return reply.code(403).send({ error: "invalid unsubscribe link" });
    }

    const subscriber = await db
      .selectFrom("subscribers")
      .select("id")
      .where("uuid", "=", subscriberUuid)
      .executeTakeFirst();
    if (subscriber) {
      const listIds = await unsubscribeFromAllLists(db, subscriber.id);
      const origin = await resolveUnsubscribeOrigin(db, automationUuid);
      await recordUnsubscribe(db, {
        subscriberId: subscriber.id,
        ...origin,
        source: "one_click",
        listIds,
      });
    }
    return { ok: true };
  });

  app.all("/api/v1/unsubscribe/:campaignUuid/:subscriberUuid", async (req, reply) => {
    const { campaignUuid, subscriberUuid } = Params.parse(req.params);
    const { sig } = z
      .object({ sig: z.string() })
      .parse({ ...(req.query as object), ...(req.body as object) });

    if (!verify(config.trackingSecret, [subscriberUuid, campaignUuid], sig)) {
      return reply.code(403).send({ error: "invalid unsubscribe link" });
    }

    const { campaignId, subscriberId } = await resolveIds(db, campaignUuid, subscriberUuid);
    if (campaignId && subscriberId) {
      const listIds = await unsubscribeFromCampaignLists(db, subscriberId, campaignId);
      await recordUnsubscribe(db, {
        subscriberId,
        campaignId,
        source: "one_click",
        listIds,
      });
    }
    return { ok: true };
  });

  // Backs the visible unsubscribe *page* (as opposed to the one-click
  // List-Unsubscribe header above): lets a subscriber see and choose which
  // of their public lists to leave, rather than blindly unsubscribing from
  // whatever the campaign happened to be sent through.
  app.get("/api/v1/unsubscribe/:campaignUuid/:subscriberUuid/lists", async (req, reply) => {
    const { campaignUuid, subscriberUuid } = Params.parse(req.params);
    const { sig } = z.object({ sig: z.string() }).parse(req.query);
    if (!verify(config.trackingSecret, [subscriberUuid, campaignUuid], sig)) {
      return reply.code(403).send({ error: "invalid unsubscribe link" });
    }

    const subscriber = await db
      .selectFrom("subscribers")
      .select(["id", "email"])
      .where("uuid", "=", subscriberUuid)
      .executeTakeFirst();
    if (!subscriber) return reply.code(404).send({ error: "not found" });

    return { email: subscriber.email, lists: await publicListsFor(db, subscriber.id) };
  });

  app.post("/api/v1/unsubscribe/:campaignUuid/:subscriberUuid/lists", async (req, reply) => {
    const { campaignUuid, subscriberUuid } = Params.parse(req.params);
    const { sig, list_ids } = z
      .object({ sig: z.string(), list_ids: z.array(z.number().int()) })
      .parse(req.body);
    if (!verify(config.trackingSecret, [subscriberUuid, campaignUuid], sig)) {
      return reply.code(403).send({ error: "invalid unsubscribe link" });
    }

    const subscriber = await db
      .selectFrom("subscribers")
      .select("id")
      .where("uuid", "=", subscriberUuid)
      .executeTakeFirst();
    if (!subscriber) return { ok: true, unsubscribe_id: null };

    const changed = await unsubscribeFromLists(db, subscriber.id, list_ids);
    // The uuid here may belong to a campaign or an automation -- both kinds
    // of email send people to this same page.
    const origin = await resolveUnsubscribeOrigin(db, campaignUuid);
    const unsubscribe_id = await recordUnsubscribe(db, {
      subscriberId: subscriber.id,
      ...origin,
      source: "preferences",
      listIds: changed,
    });
    return { ok: true, unsubscribe_id };
  });

  app.post("/api/v1/unsubscribe/:campaignUuid/:subscriberUuid/all", async (req, reply) => {
    const { campaignUuid, subscriberUuid } = Params.parse(req.params);
    const { sig } = z.object({ sig: z.string() }).parse(req.body);
    if (!verify(config.trackingSecret, [subscriberUuid, campaignUuid], sig)) {
      return reply.code(403).send({ error: "invalid unsubscribe link" });
    }

    const subscriber = await db
      .selectFrom("subscribers")
      .select("id")
      .where("uuid", "=", subscriberUuid)
      .executeTakeFirst();
    if (!subscriber) return { ok: true, unsubscribe_id: null };

    const listIds = await unsubscribeFromAllLists(db, subscriber.id);
    const origin = await resolveUnsubscribeOrigin(db, campaignUuid);
    const unsubscribe_id = await recordUnsubscribe(db, {
      subscriberId: subscriber.id,
      ...origin,
      source: "all",
      listIds,
    });
    return { ok: true, unsubscribe_id };
  });

  /** The older page's counterpart to /api/v1/u/:ref/:s/:sig/reason. */
  app.post("/api/v1/unsubscribe/:campaignUuid/:subscriberUuid/reason", async (req, reply) => {
    const { campaignUuid, subscriberUuid } = Params.parse(req.params);
    const { sig } = z.object({ sig: z.string() }).parse(req.body);
    if (!verify(config.trackingSecret, [subscriberUuid, campaignUuid], sig)) {
      return reply.code(403).send({ error: "invalid unsubscribe link" });
    }
    const body = ReasonBody.parse(req.body);

    const subscriber = await db
      .selectFrom("subscribers")
      .select("id")
      .where("uuid", "=", subscriberUuid)
      .executeTakeFirst();
    if (subscriber) {
      await setUnsubscribeReason(db, {
        unsubscribeId: body.unsubscribe_id,
        subscriberId: subscriber.id,
        reason: body.reason,
        comment: body.comment,
      });
    }
    return { ok: true };
  });
}
