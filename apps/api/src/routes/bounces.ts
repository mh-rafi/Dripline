import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import { recordBounce } from "../services/bounces.js";

const BounceBody = z.object({
  email: z.string().email(),
  campaign_uuid: z.string().uuid().optional(),
  type: z.enum(["hard", "soft", "complaint"]).default("hard"),
  source: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});

/** Generic bounce-webhook ingestion. Provider-specific formats (SES, Postmark, etc.)
 * should be normalized to this shape at the edge or via a small adapter later. */
export default async function bounceRoutes(app: FastifyInstance, opts: { db: DB }) {
  const { db } = opts;
  app.addHook("preHandler", app.requireAuth);

  app.post("/api/v1/bounces", async (req) => {
    const body = BounceBody.parse(req.body);

    const subscriber = await db
      .selectFrom("subscribers")
      .select("id")
      .where("email", "=", body.email)
      .executeTakeFirst();
    if (!subscriber) return { ok: true, note: "unknown subscriber, ignored" };

    const campaign = body.campaign_uuid
      ? await db
          .selectFrom("campaigns")
          .select("id")
          .where("uuid", "=", body.campaign_uuid)
          .executeTakeFirst()
      : null;

    await recordBounce(db, {
      subscriberId: subscriber.id,
      campaignId: campaign?.id ?? null,
      type: body.type,
      source: body.source,
      meta: body.meta,
    });

    return { ok: true };
  });

  app.get("/api/v1/bounces", async (req) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().max(200).default(50) })
      .parse(req.query);
    return db
      .selectFrom("bounces")
      .innerJoin("subscribers", "subscribers.id", "bounces.subscriber_id")
      .select([
        "bounces.id",
        "bounces.type",
        "bounces.source",
        "bounces.created_at",
        "subscribers.email",
      ])
      .orderBy("bounces.id", "desc")
      .limit(limit)
      .execute();
  });
}
