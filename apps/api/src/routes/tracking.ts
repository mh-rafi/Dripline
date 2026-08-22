import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import type { Config } from "../config.js";
import { verify } from "../lib/signing.js";
import { TRANSPARENT_GIF } from "../lib/pixel.js";
import { recordEvent } from "../services/workflows.js";
import { unsubscribeFromCampaignLists } from "../services/subscribers.js";

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
      await unsubscribeFromCampaignLists(db, subscriberId, campaignId);
    }
    return { ok: true };
  });
}
