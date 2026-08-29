import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import type { Config } from "../config.js";
import { NotFoundError } from "../lib/errors.js";
import {
  getCampaignUnsubscribeCounts,
  listCampaignUnsubscribes,
} from "../services/unsubscribes.js";
import {
  cancelCampaign,
  reopenCampaign,
  duplicateCampaign,
  getCampaignOrThrow,
  getCampaignProgress,
  pauseCampaign,
  previewCampaign,
  sendTestEmail,
  startCampaign,
} from "../services/campaigns.js";

const ContentType = z.enum(["richtext", "html", "plain", "markdown", "visual"]);

const CreateCampaignShape = z.object({
  name: z.string().min(1),
  subject: z.string().min(1),
  // Inbox-preview snippet, shown next to the subject in the recipient's mail
  // client list -- never inside the opened email. See services/mailer.ts
  // injectPreheader for how it actually reaches the rendered HTML.
  preheader: z.string().optional(),
  body: z.string().default(""),
  // Original editor source (markdown text, visual builder JSON, or a mirror
  // of `body` for richtext/html/plain). See db/types.ts CampaignsTable.
  body_source: z.string().nullish(),
  content_type: ContentType.default("richtext"),
  from_email: z.string().email().optional(),
  from_name: z.string().optional(),
  reply_to: z.string().email().optional(),
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
  track_opens: z.boolean().default(true),
  track_clicks: z.boolean().default(true),
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
  .extend({
    // Unlike create, edit needs to be able to explicitly clear these (the UI
    // sends `null` for "None"/"unlimited"), not just omit the fields.
    template_id: z.number().int().nullable().optional(),
    preheader: z.string().nullable().optional(),
    from_name: z.string().nullable().optional(),
    reply_to: z
      .union([z.string().email(), z.literal("")])
      .nullable()
      .optional(),
    rate_limit_count: z.number().int().positive().nullable().optional(),
    rate_limit_duration_seconds: z.number().int().positive().nullable().optional(),
    // `.partial()` keeps a `.default(...)` on the base shape active -- an
    // omitted field would parse to the create-time default (e.g. `body: ""`,
    // `content_type: "richtext"`) instead of `undefined`, and the handler's
    // `...body` spread would then silently overwrite the existing value on
    // every PATCH that doesn't happen to repeat it. Redeclared default-less
    // here so an omitted field really does stay omitted from the parsed body.
    body: z.string().optional(),
    content_type: ContentType.optional(),
    track_opens: z.boolean().optional(),
    track_clicks: z.boolean().optional(),
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
  preheader: z.string().nullish(),
  body: z.string().optional(),
  body_source: z.string().nullish(),
  content_type: ContentType.optional(),
  from_email: z.string().email().nullish(),
  // Empty string clears the override; the DB stores null for "not set" so the
  // send path can tell "no override" from "deliberately blank".
  from_name: z.string().nullish(),
  reply_to: z.union([z.string().email(), z.literal("")]).nullish(),
  template_id: z.number().int().nullish(),
});

const EmailsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const Preview = z.object({
  subject: z.string().optional(),
  preheader: z.string().optional(),
  body: z.string(),
  body_source: z.string().nullish(),
  content_type: ContentType.optional(),
  template_id: z.number().int().nullish(),
});

export default async function campaignRoutes(
  app: FastifyInstance,
  opts: { db: DB; config: Config },
) {
  const { db, config } = opts;
  app.addHook("preHandler", app.requireAuth);

  app.get("/api/v1/campaigns", { preHandler: app.requirePermission("campaigns:get") }, async () => {
    const campaigns = await db.selectFrom("campaigns").selectAll().orderBy("id", "desc").execute();

    // campaigns.sent/to_send are never updated past campaign creation (the
    // dispatch job only ever writes per-row campaign_emails.status) -- so,
    // like getCampaignProgress, these are computed live rather than read
    // off those stale columns.
    const counts = await db
      .selectFrom("campaign_emails")
      .select(["campaign_id", "status", db.fn.countAll().as("count")])
      .groupBy(["campaign_id", "status"])
      .execute();
    const byCampaign = new Map<number, { sent: number; total: number }>();
    for (const row of counts) {
      const entry = byCampaign.get(row.campaign_id) ?? { sent: 0, total: 0 };
      const count = Number(row.count);
      entry.total += count;
      if (row.status === "sent") entry.sent = count;
      byCampaign.set(row.campaign_id, entry);
    }

    return campaigns.map((c) => {
      const counted = byCampaign.get(c.id);
      return { ...c, sent: counted?.sent ?? 0, to_send: counted?.total ?? 0 };
    });
  });

  app.get(
    "/api/v1/campaigns/:id",
    { preHandler: app.requirePermission("campaigns:get") },
    async (req) => {
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
    },
  );

  app.post(
    "/api/v1/campaigns",
    { preHandler: app.requirePermission("campaigns:manage") },
    async (req, reply) => {
      const body = CreateCampaign.parse(req.body);
      const campaign = await db
        .insertInto("campaigns")
        .values({
          name: body.name,
          subject: body.subject,
          preheader: body.preheader || null,
          body: body.body,
          body_source: body.body_source ?? null,
          content_type: body.content_type,
          from_email: body.from_email ?? null,
          from_name: body.from_name || null,
          reply_to: body.reply_to || null,
          template_id: body.template_id ?? null,
          send_at: body.send_at ?? null,
          rate_limit_count: body.rate_limit_count ?? null,
          rate_limit_duration_seconds: body.rate_limit_duration_seconds ?? null,
          track_opens: body.track_opens,
          track_clicks: body.track_clicks,
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
    },
  );

  app.patch(
    "/api/v1/campaigns/:id",
    { preHandler: app.requirePermission("campaigns:manage") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      const body = UpdateCampaign.parse(req.body);
      const campaign = await db
        .updateTable("campaigns")
        // A blank override is stored as NULL, so the send path only has to check
        // for null rather than for null-or-empty at every use site.
        .set({
          ...body,
          ...(body.preheader !== undefined ? { preheader: body.preheader || null } : {}),
          ...(body.from_name !== undefined ? { from_name: body.from_name || null } : {}),
          ...(body.reply_to !== undefined ? { reply_to: body.reply_to || null } : {}),
        })
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();
      if (!campaign) throw new NotFoundError("campaign");
      return campaign;
    },
  );

  app.put(
    "/api/v1/campaigns/:id/lists",
    { preHandler: app.requirePermission("campaigns:manage") },
    async (req) => {
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
    },
  );

  app.put(
    "/api/v1/campaigns/:id/connections",
    { preHandler: app.requirePermission("campaigns:manage") },
    async (req) => {
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
    },
  );

  app.delete(
    "/api/v1/campaigns/:id",
    { preHandler: app.requirePermission("campaigns:manage") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      await db
        .deleteFrom("campaigns")
        .where("id", "=", id)
        .where("status", "in", ["draft", "scheduled", "finished"])
        .execute();
      return { ok: true };
    },
  );

  app.post(
    "/api/v1/campaigns/:id/duplicate",
    { preHandler: app.requirePermission("campaigns:manage") },
    async (req, reply) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      const copy = await duplicateCampaign(db, id);
      reply.code(201);
      return copy;
    },
  );

  app.post(
    "/api/v1/campaigns/:id/start",
    { preHandler: app.requirePermission("campaigns:send") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      return startCampaign(db, id);
    },
  );

  app.post(
    "/api/v1/campaigns/:id/pause",
    { preHandler: app.requirePermission("campaigns:send") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      return pauseCampaign(db, id);
    },
  );

  app.post(
    "/api/v1/campaigns/:id/cancel",
    { preHandler: app.requirePermission("campaigns:send") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      return cancelCampaign(db, id);
    },
  );

  app.post(
    "/api/v1/campaigns/:id/reopen",
    { preHandler: app.requirePermission("campaigns:send") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      return reopenCampaign(db, id);
    },
  );

  app.post(
    "/api/v1/campaigns/:id/test",
    { preHandler: app.requirePermission("campaigns:manage") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      const body = TestEmail.parse(req.body);
      const { email, ...overrides } = body;
      return sendTestEmail(db, config, id, email, {
        ...overrides,
        from_name: overrides.from_name || null,
        reply_to: overrides.reply_to || null,
      });
    },
  );

  // Unlike /test, works for a never-saved draft (no campaign id, no
  // sending connection required) -- renders the same way a real send would
  // (merge fields, template wrapper, tracking links) against a synthetic
  // subscriber, returning HTML for the UI to display directly.
  app.post(
    "/api/v1/campaigns/preview",
    { preHandler: app.requirePermission("campaigns:get") },
    async (req) => {
      const body = Preview.parse(req.body);
      return previewCampaign(db, config, body);
    },
  );

  app.get(
    "/api/v1/campaigns/:id/progress",
    { preHandler: app.requirePermission("campaigns:get") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      return getCampaignProgress(db, id);
    },
  );

  app.get(
    "/api/v1/campaigns/:id/analytics",
    { preHandler: app.requirePermission("campaigns:get") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      const [opens, uniqueOpens, clicks, uniqueClicks, unsubscribes] = await Promise.all([
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
        getCampaignUnsubscribeCounts(db, id),
      ]);

      return {
        opens: Number(opens?.count ?? 0),
        unique_opens: Number(uniqueOpens?.count ?? 0),
        clicks: Number(clicks?.count ?? 0),
        unique_clicks: Number(uniqueClicks?.count ?? 0),
        ...unsubscribes,
      };
    },
  );

  app.get(
    "/api/v1/campaigns/:id/emails",
    { preHandler: app.requirePermission("campaigns:get") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      const { limit, offset } = EmailsQuery.parse(req.query);

      // Per-subscriber open/click counts, pre-aggregated so the join to
      // campaign_emails (one row per recipient) doesn't fan out.
      const opensBySubscriber = db
        .selectFrom("campaign_views")
        .select(["subscriber_id", db.fn.countAll().as("count")])
        .where("campaign_id", "=", id)
        .groupBy("subscriber_id")
        .as("opens_by_subscriber");
      const clicksBySubscriber = db
        .selectFrom("link_clicks")
        .select(["subscriber_id", db.fn.countAll().as("count")])
        .where("campaign_id", "=", id)
        .groupBy("subscriber_id")
        .as("clicks_by_subscriber");

      const [emails, totalResult] = await Promise.all([
        db
          .selectFrom("campaign_emails")
          .innerJoin("subscribers", "subscribers.id", "campaign_emails.subscriber_id")
          .leftJoin(opensBySubscriber, (join) =>
            join.onRef("opens_by_subscriber.subscriber_id", "=", "campaign_emails.subscriber_id"),
          )
          .leftJoin(clicksBySubscriber, (join) =>
            join.onRef("clicks_by_subscriber.subscriber_id", "=", "campaign_emails.subscriber_id"),
          )
          .select([
            "campaign_emails.id",
            "campaign_emails.subscriber_id",
            "subscribers.email as subscriber_email",
            "subscribers.name as subscriber_name",
            "campaign_emails.status",
            "campaign_emails.sent_at",
            sql<number>`coalesce(opens_by_subscriber.count, 0)`.as("opens"),
            sql<number>`coalesce(clicks_by_subscriber.count, 0)`.as("clicks"),
          ])
          .where("campaign_emails.campaign_id", "=", id)
          .orderBy("campaign_emails.id", "desc")
          .limit(limit)
          .offset(offset)
          .execute(),
        db
          .selectFrom("campaign_emails")
          .select(db.fn.countAll().as("count"))
          .where("campaign_id", "=", id)
          .executeTakeFirstOrThrow(),
      ]);

      return { emails, total: Number(totalResult.count) };
    },
  );

  app.get(
    "/api/v1/campaigns/:id/unsubscribes",
    { preHandler: app.requirePermission("campaigns:get") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      const { limit, offset } = EmailsQuery.parse(req.query);
      return listCampaignUnsubscribes(db, id, limit, offset);
    },
  );
}
