import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import type { Config } from "../config.js";
import { NotFoundError } from "../lib/errors.js";
import {
  cancelCampaign,
  getCampaignOrThrow,
  getCampaignProgress,
  pauseCampaign,
  sendTestEmail,
  startCampaign,
} from "../services/campaigns.js";

const ContentType = z.enum(["richtext", "html", "plain", "markdown", "visual"]);

const CreateCampaignShape = z.object({
  name: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().default(""),
  // Original editor source (markdown text, visual builder JSON, or a mirror
  // of `body` for richtext/html/plain). See db/types.ts CampaignsTable.
  body_source: z.string().nullish(),
  content_type: ContentType.default("richtext"),
  from_email: z.string().email().optional(),
  template_id: z.number().int().optional(),
  list_ids: z.array(z.number().int()).default([]),
  connection_ids: z.array(z.number().int()).default([]),
  send_at: z.string().datetime().optional(),
  // Optional secondary throttle on top of the connection's own rate limit.
  // Both must be set together (or both omitted/null = unlimited) -- a count
  // with no duration (or vice versa) is silently treated as "unlimited" by
  // the rate limiter, which would be a confusing footgun if allowed through.
  rate_limit_count: z.number().int().positive().nullish(),
  rate_limit_duration_seconds: z.number().int().positive().nullish(),
});
function requireRateLimitPair<
  T extends { rate_limit_count?: number | null; rate_limit_duration_seconds?: number | null },
>(body: T, ctx: z.RefinementCtx) {
  const hasCount = body.rate_limit_count != null;
  const hasDuration = body.rate_limit_duration_seconds != null;
  if (hasCount !== hasDuration) {
    ctx.addIssue({
      code: "custom",
      message: "rate_limit_count and rate_limit_duration_seconds must be set together",
    });
  }
}
const CreateCampaign = CreateCampaignShape.superRefine(requireRateLimitPair);
const UpdateCampaign = CreateCampaignShape.partial()
  .omit({ list_ids: true, connection_ids: true })
  // Unlike create, edit needs to be able to explicitly clear these (the UI
  // sends `null` for "None"/"unlimited"), not just omit the fields.
  .extend({
    template_id: z.number().int().nullable().optional(),
    rate_limit_count: z.number().int().positive().nullable().optional(),
    rate_limit_duration_seconds: z.number().int().positive().nullable().optional(),
  })
  // Only enforced when the caller is touching the throttle at all -- a PATCH
  // that omits both fields entirely (leaving the existing value untouched)
  // is fine; one set to a real value while the other is omitted is not.
  .superRefine((body, ctx) => {
    if (body.rate_limit_count === undefined && body.rate_limit_duration_seconds === undefined)
      return;
    requireRateLimitPair(body, ctx);
  });

const TestEmail = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  body_source: z.string().nullish(),
  content_type: ContentType.optional(),
  from_email: z.string().email().nullish(),
  template_id: z.number().int().nullish(),
});

export default async function campaignRoutes(
  app: FastifyInstance,
  opts: { db: DB; config: Config },
) {
  const { db, config } = opts;
  app.addHook("preHandler", app.requireAuth);

  app.get("/api/v1/campaigns", async () =>
    db.selectFrom("campaigns").selectAll().orderBy("id", "desc").execute(),
  );

  app.get("/api/v1/campaigns/:id", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    const campaign = await getCampaignOrThrow(db, id);
    const lists = await db
      .selectFrom("campaign_lists")
      .innerJoin("lists", "lists.id", "campaign_lists.list_id")
      .select(["lists.id", "lists.name"])
      .where("campaign_id", "=", id)
      .execute();
    const connections = await db
      .selectFrom("campaign_connections")
      .innerJoin("connections", "connections.id", "campaign_connections.connection_id")
      .select([
        "connections.id",
        "connections.name",
        "connections.from_email",
        "connections.type",
        "campaign_connections.priority",
      ])
      .where("campaign_connections.campaign_id", "=", id)
      .orderBy("campaign_connections.priority", "asc")
      .execute();
    const progress = await getCampaignProgress(db, id);
    return { ...campaign, lists, connections, progress };
  });

  app.post("/api/v1/campaigns", async (req, reply) => {
    const body = CreateCampaign.parse(req.body);
    const campaign = await db
      .insertInto("campaigns")
      .values({
        name: body.name,
        subject: body.subject,
        body: body.body,
        body_source: body.body_source ?? null,
        content_type: body.content_type,
        from_email: body.from_email ?? null,
        template_id: body.template_id ?? null,
        send_at: body.send_at ?? null,
        rate_limit_count: body.rate_limit_count ?? null,
        rate_limit_duration_seconds: body.rate_limit_duration_seconds ?? null,
        status: body.send_at ? "scheduled" : "draft",
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    if (body.list_ids.length > 0) {
      await db
        .insertInto("campaign_lists")
        .values(body.list_ids.map((list_id) => ({ campaign_id: campaign.id, list_id })))
        .execute();
    }
    if (body.connection_ids.length > 0) {
      await db
        .insertInto("campaign_connections")
        .values(
          body.connection_ids.map((connection_id, priority) => ({
            campaign_id: campaign.id,
            connection_id,
            priority,
          })),
        )
        .execute();
    }
    reply.code(201);
    return campaign;
  });

  app.patch("/api/v1/campaigns/:id", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    const body = UpdateCampaign.parse(req.body);
    const campaign = await db
      .updateTable("campaigns")
      .set(body)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    if (!campaign) throw new NotFoundError("campaign");
    return campaign;
  });

  app.put("/api/v1/campaigns/:id/lists", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    const { list_ids } = z.object({ list_ids: z.array(z.number().int()) }).parse(req.body);
    await db.deleteFrom("campaign_lists").where("campaign_id", "=", id).execute();
    if (list_ids.length > 0) {
      await db
        .insertInto("campaign_lists")
        .values(list_ids.map((list_id) => ({ campaign_id: id, list_id })))
        .execute();
    }
    return { ok: true };
  });

  app.put("/api/v1/campaigns/:id/connections", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    const { connection_ids } = z
      .object({ connection_ids: z.array(z.number().int()) })
      .parse(req.body);
    await db.deleteFrom("campaign_connections").where("campaign_id", "=", id).execute();
    if (connection_ids.length > 0) {
      await db
        .insertInto("campaign_connections")
        .values(
          connection_ids.map((connection_id, priority) => ({
            campaign_id: id,
            connection_id,
            priority,
          })),
        )
        .execute();
    }
    return { ok: true };
  });

  app.delete("/api/v1/campaigns/:id", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    await db
      .deleteFrom("campaigns")
      .where("id", "=", id)
      .where("status", "in", ["draft", "scheduled"])
      .execute();
    return { ok: true };
  });

  app.post("/api/v1/campaigns/:id/start", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    return startCampaign(db, id);
  });

  app.post("/api/v1/campaigns/:id/pause", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    return pauseCampaign(db, id);
  });

  app.post("/api/v1/campaigns/:id/cancel", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    return cancelCampaign(db, id);
  });

  app.post("/api/v1/campaigns/:id/test", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    const body = TestEmail.parse(req.body);
    const { email, ...overrides } = body;
    return sendTestEmail(db, config, id, email, overrides);
  });

  app.get("/api/v1/campaigns/:id/progress", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    return getCampaignProgress(db, id);
  });

  app.get("/api/v1/campaigns/:id/analytics", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    const [opens, uniqueOpens, clicks, uniqueClicks] = await Promise.all([
      db
        .selectFrom("campaign_views")
        .select(db.fn.countAll().as("count"))
        .where("campaign_id", "=", id)
        .executeTakeFirst(),
      db
        .selectFrom("campaign_views")
        .select(db.fn.count("subscriber_id").distinct().as("count"))
        .where("campaign_id", "=", id)
        .executeTakeFirst(),
      db
        .selectFrom("link_clicks")
        .select(db.fn.countAll().as("count"))
        .where("campaign_id", "=", id)
        .executeTakeFirst(),
      db
        .selectFrom("link_clicks")
        .select(db.fn.count("subscriber_id").distinct().as("count"))
        .where("campaign_id", "=", id)
        .executeTakeFirst(),
    ]);

    return {
      opens: Number(opens?.count ?? 0),
      unique_opens: Number(uniqueOpens?.count ?? 0),
      clicks: Number(clicks?.count ?? 0),
      unique_clicks: Number(uniqueClicks?.count ?? 0),
    };
  });
}
