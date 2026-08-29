import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import type { Config } from "../config.js";
import { verify } from "../lib/signing.js";
import { TRANSPARENT_GIF } from "../lib/pixel.js";
import { recordEvent } from "../services/automations.js";
import {
  unsubscribeFromAllLists,
  unsubscribeFromCampaignLists,
  unsubscribeFromLists,
} from "../services/subscribers.js";
import { recordUnsubscribe, resolveUnsubscribeOrigin } from "../services/unsubscribes.js";

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

export default async function trackingRoutes(
  app: FastifyInstance,
  opts: { db: DB; config: Config },
) {
  const { db, config } = opts;

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

    const lists = await db
      .selectFrom("subscriber_lists")
      .innerJoin("lists", "lists.id", "subscriber_lists.list_id")
      .select(["lists.id", "lists.name"])
      .where("subscriber_lists.subscriber_id", "=", subscriber.id)
      .where("lists.type", "=", "public")
      .where("subscriber_lists.status", "!=", "unsubscribed")
      .execute();

    return { email: subscriber.email, lists };
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
    if (subscriber) {
      const changed = await unsubscribeFromLists(db, subscriber.id, list_ids);
      // The uuid here may belong to a campaign or an automation -- both kinds
      // of email send people to this same page.
      const origin = await resolveUnsubscribeOrigin(db, campaignUuid);
      await recordUnsubscribe(db, {
        subscriberId: subscriber.id,
        ...origin,
        source: "preferences",
        listIds: changed,
      });
    }
    return { ok: true };
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
    if (subscriber) {
      const listIds = await unsubscribeFromAllLists(db, subscriber.id);
      const origin = await resolveUnsubscribeOrigin(db, campaignUuid);
      await recordUnsubscribe(db, {
        subscriberId: subscriber.id,
        ...origin,
        source: "all",
        listIds,
      });
    }
    return { ok: true };
  });
}
