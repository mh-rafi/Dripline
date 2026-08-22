import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import { NotFoundError } from "../lib/errors.js";
import {
  cancelCampaign,
  getCampaignOrThrow,
  getCampaignProgress,
  pauseCampaign,
  startCampaign,
} from "../services/campaigns.js";

const CreateCampaign = z.object({
  name: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().default(""),
  from_email: z.string().email().optional(),
  template_id: z.number().int().optional(),
  list_ids: z.array(z.number().int()).default([]),
  send_at: z.string().datetime().optional(),
  messages_per_minute: z.number().int().positive().default(60),
});
const UpdateCampaign = CreateCampaign.partial().omit({ list_ids: true });

export default async function campaignRoutes(app: FastifyInstance, opts: { db: DB }) {
  const { db } = opts;
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
    const progress = await getCampaignProgress(db, id);
    return { ...campaign, lists, progress };
  });

  app.post("/api/v1/campaigns", async (req, reply) => {
    const body = CreateCampaign.parse(req.body);
    const campaign = await db
      .insertInto("campaigns")
      .values({
        name: body.name,
        subject: body.subject,
        body: body.body,
        from_email: body.from_email ?? null,
        template_id: body.template_id ?? null,
        send_at: body.send_at ?? null,
        messages_per_minute: body.messages_per_minute,
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
