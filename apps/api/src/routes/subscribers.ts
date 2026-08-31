import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql, type SelectQueryBuilder } from "kysely";
import type { DB } from "../db/kysely.js";
import type { Database } from "../db/types.js";
import {
  addTag,
  addToList,
  addToListForImport,
  blocklistSubscriber,
  attribsAssignment,
  createSubscriber,
  getSubscriberOrThrow,
  removeFromList,
  removeTag,
  unblocklistSubscriber,
} from "../services/subscribers.js";
import type { SubscriberFilter } from "../services/subscriberFilter.js";
import { bulkBlocklist, bulkDelete, bulkLists } from "../services/bulkActions.js";
import { exportSubscribers } from "../services/subscriberExport.js";

const AttribsModeEnum = z.enum(["merge", "replace"]);

const CreateSubscriber = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  status: z.enum(["enabled", "blocklisted"]).default("enabled"),
  attribs: z.record(z.string(), z.unknown()).optional(),
  attribs_mode: AttribsModeEnum.default("merge"),
  list_ids: z.array(z.number().int()).optional(),
  preconfirm: z.boolean().default(false),
  resubscribe: z.boolean().default(false),
});
const UpdateSubscriber = z.object({
  name: z.string().optional(),
  attribs: z.record(z.string(), z.unknown()).optional(),
  attribs_mode: AttribsModeEnum.default("merge"),
});
const ListMembershipStatusEnum = z.enum(["unconfirmed", "confirmed", "unsubscribed"]);

// Comma-separated query-string values -- GET /subscribers takes list_ids and
// list_statuses this way (there's no repeated-param or JSON encoding for a
// plain query string), unlike the JSON bodies below which take real arrays.
function commaList<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (val) => (typeof val === "string" && val.length > 0 ? val.split(",") : undefined),
    z.array(schema).optional(),
  );
}

const ListQuery = z.object({
  q: z.string().optional(),
  // Exact match, unlike `q`'s substring search -- an external system keyed by
  // email needs a lookup that can't also return someone else's address.
  email: z.string().optional(),
  // JSON object in the query string, matched by containment:
  // `?attribs={"plan":"pro"}`. A malformed value is a validation error rather
  // than a silently ignored filter, which would return the wrong rows.
  attribs: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return undefined;
      try {
        const parsed: unknown = JSON.parse(v);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // fall through to the issue below
      }
      ctx.addIssue({ code: "custom", message: "attribs must be a JSON object" });
      return z.NEVER;
    }),
  tags: commaList(z.string()),
  list_ids: commaList(z.coerce.number().int()),
  list_statuses: commaList(ListMembershipStatusEnum),
  blocklisted: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// Bulk selector — either explicit IDs (1-1000 per request, the frontend
// chunks above that) or a query-mode "select all matching" that re-runs
// the same server-side filter the list page used.
const BulkSelector = z.union([
  z.object({
    ids: z.array(z.number().int()).min(1).max(1000),
  }),
  z.object({
    query: z.object({
      q: z.string().optional(),
      email: z.string().optional(),
      attribs: z.record(z.string(), z.unknown()).optional(),
      tags: z.array(z.string()).optional(),
      list_ids: z.array(z.number().int()).optional(),
      list_statuses: z.array(ListMembershipStatusEnum).optional(),
      blocklisted: z.boolean().optional(),
    }),
    all: z.literal(true),
  }),
]);

/** Applies the subscriber list/search filter to a query builder -- shared
 * between the paged results query and the total-count query so they can
 * never drift apart. */
function applySubscriberFilter<O>(
  builder: SelectQueryBuilder<Database, "subscribers", O>,
  filter: SubscriberFilter,
): SelectQueryBuilder<Database, "subscribers", O> {
  let b = builder;
  if (filter.email) b = b.where("email", "=", filter.email);
  if (filter.attribs && Object.keys(filter.attribs).length > 0) {
    const attribs = filter.attribs;
    b = b.where(sql<boolean>`attribs @> ${JSON.stringify(attribs)}::jsonb`);
  }
  if (filter.tags?.length) {
    const tags = filter.tags;
    b = b.where(sql<boolean>`tags && ${tags}::text[]`);
  }
  if (filter.q) {
    const q = filter.q;
    b = b.where((eb) => eb.or([eb("email", "ilike", `%${q}%`), eb("name", "ilike", `%${q}%`)]));
  }
  const hasListFilter = !!(filter.list_ids?.length || filter.list_statuses?.length);
  if (hasListFilter || filter.blocklisted) {
    b = b.where((eb) => {
      const clauses = [];
      if (hasListFilter) {
        let sub = eb.selectFrom("subscriber_lists").select("subscriber_id");
        if (filter.list_ids?.length) sub = sub.where("list_id", "in", filter.list_ids);
        if (filter.list_statuses?.length) sub = sub.where("status", "in", filter.list_statuses);
        clauses.push(eb("subscribers.id", "in", sub));
      }
      // blocklisted is a global account state, OR'd rather than AND'd with
      // the list condition -- see SubscriberFilter.blocklisted in
      // subscriberFilter.ts for why.
      if (filter.blocklisted) clauses.push(eb("subscribers.status", "=", "blocklisted"));
      return eb.or(clauses);
    });
  }
  return b;
}

export default async function subscriberRoutes(app: FastifyInstance, opts: { db: DB }) {
  const { db } = opts;
  app.addHook("preHandler", app.requireAuth);

  app.get(
    "/api/v1/subscribers",
    { preHandler: app.requirePermission("subscribers:get") },
    async (req) => {
      const query = ListQuery.parse(req.query);
      const filter: SubscriberFilter = {
        q: query.q,
        email: query.email,
        attribs: query.attribs,
        tags: query.tags,
        list_ids: query.list_ids,
        list_statuses: query.list_statuses,
        blocklisted: query.blocklisted,
      };

      const pageQuery = applySubscriberFilter(
        db
          .selectFrom("subscribers")
          .selectAll()
          .orderBy("id", "desc")
          .limit(query.limit)
          .offset(query.offset),
        filter,
      );
      const totalQuery = applySubscriberFilter(
        db.selectFrom("subscribers").select(db.fn.countAll().as("count")),
        filter,
      );

      const [subscribers, totalResult] = await Promise.all([
        pageQuery.execute(),
        totalQuery.executeTakeFirstOrThrow(),
      ]);

      return { subscribers, total: Number(totalResult.count) };
    },
  );

  app.get(
    "/api/v1/subscribers/:id",
    { preHandler: app.requirePermission("subscribers:get") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      const subscriber = await getSubscriberOrThrow(db, id);
      const lists = await db
        .selectFrom("subscriber_lists")
        .innerJoin("lists", "lists.id", "subscriber_lists.list_id")
        .select(["lists.id", "lists.name", "lists.optin", "subscriber_lists.status"])
        .where("subscriber_id", "=", id)
        .execute();
      return { ...subscriber, lists };
    },
  );

  app.post(
    "/api/v1/subscribers",
    { preHandler: app.requirePermission("subscribers:manage") },
    async (req, reply) => {
      const body = CreateSubscriber.parse(req.body);
      const upsert = await createSubscriber(db, {
        email: body.email,
        name: body.name,
        attribs: body.attribs,
        attribsMode: body.attribs_mode,
      });
      let subscriber = upsert.subscriber;

      for (const listId of body.list_ids ?? []) {
        await addToList(db, subscriber.id, listId, body.preconfirm ? "confirmed" : undefined, {
          resubscribe: body.resubscribe,
        });
      }

      if (body.status === "blocklisted") {
        await blocklistSubscriber(db, subscriber.id);
        subscriber = await getSubscriberOrThrow(db, subscriber.id);
      }

      reply.code(upsert.created ? 201 : 200);
      return subscriber;
    },
  );

  app.patch(
    "/api/v1/subscribers/:id",
    { preHandler: app.requirePermission("subscribers:manage") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      const body = UpdateSubscriber.parse(req.body);
      await getSubscriberOrThrow(db, id);
      return db
        .updateTable("subscribers")
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.attribs !== undefined
            ? { attribs: attribsAssignment(body.attribs_mode, body.attribs) }
            : {}),
        })
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirstOrThrow();
    },
  );

  app.delete(
    "/api/v1/subscribers/:id",
    { preHandler: app.requirePermission("subscribers:manage") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      await db.deleteFrom("subscribers").where("id", "=", id).execute();
      return { ok: true };
    },
  );

  app.post(
    "/api/v1/subscribers/:id/blocklist",
    { preHandler: app.requirePermission("subscribers:manage") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      await blocklistSubscriber(db, id);
      return { ok: true };
    },
  );

  app.post(
    "/api/v1/subscribers/:id/unblocklist",
    { preHandler: app.requirePermission("subscribers:manage") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      await unblocklistSubscriber(db, id);
      return { ok: true };
    },
  );

  app.put(
    "/api/v1/subscribers/:id/lists/:listId",
    { preHandler: app.requirePermission("subscribers:manage") },
    async (req) => {
      const { id, listId } = z
        .object({ id: z.coerce.number(), listId: z.coerce.number() })
        .parse(req.params);
      const { status } = z
        .object({ status: z.enum(["unconfirmed", "confirmed"]).optional() })
        .parse(req.body ?? {});
      // Explicit, per-contact admin action: this is the one path allowed to
      // lift a membership back out of `unsubscribed`.
      await addToList(db, id, listId, status, { resubscribe: true });
      return { ok: true };
    },
  );

  app.delete(
    "/api/v1/subscribers/:id/lists/:listId",
    { preHandler: app.requirePermission("subscribers:manage") },
    async (req) => {
      const { id, listId } = z
        .object({ id: z.coerce.number(), listId: z.coerce.number() })
        .parse(req.params);
      await removeFromList(db, id, listId);
      return { ok: true };
    },
  );

  app.put(
    "/api/v1/subscribers/:id/tags/:tag",
    { preHandler: app.requirePermission("subscribers:manage") },
    async (req) => {
      const { id, tag } = z.object({ id: z.coerce.number(), tag: z.string() }).parse(req.params);
      await addTag(db, id, tag);
      return { ok: true };
    },
  );

  app.delete(
    "/api/v1/subscribers/:id/tags/:tag",
    { preHandler: app.requirePermission("subscribers:manage") },
    async (req) => {
      const { id, tag } = z.object({ id: z.coerce.number(), tag: z.string() }).parse(req.params);
      await removeTag(db, id, tag);
      return { ok: true };
    },
  );

  const ImportBody = z.object({
    mode: z.enum(["subscribe", "blocklist"]).default("subscribe"),
    status: z.enum(["unconfirmed", "confirmed"]).default("confirmed"),
    list_ids: z.array(z.number().int()).default([]),
    overwrite_user_info: z.boolean().default(false),
    overwrite_subscription_status: z.boolean().default(false),
    attribs_mode: z.enum(["merge", "replace", "skip"]).default("merge"),
    tags_mode: z.enum(["merge", "replace", "skip"]).default("merge"),
    // Capped so one request stays a bounded unit of work: the admin UI posts
    // in batches of 300, and an uncapped array is a request that can run for
    // minutes and then time out with nothing to report.
    subscribers: z
      .array(
        z.object({
          email: z.string().email(),
          name: z.string().optional(),
          attribs: z.record(z.string(), z.unknown()).optional(),
          tags: z.array(z.string()).optional(),
        }),
      )
      .max(1000),
  });

  app.post(
    "/api/v1/subscribers/import",
    { preHandler: app.requirePermission("subscribers:import") },
    async (req) => {
      const body = ImportBody.parse(req.body);

      let created = 0;
      let updated = 0;
      const failed: { email: string; error: string }[] = [];

      for (const s of body.subscribers) {
        // Per row, not per request: one bad address (or a row that trips a
        // constraint) must not discard the hundreds that imported fine, and
        // the caller needs to know *which* rows to fix. Rows land
        // independently -- an import is not atomic.
        let wasCreated: boolean;
        try {
          const existing = await db
            .selectFrom("subscribers")
            .select("id")
            .where("email", "=", s.email)
            .executeTakeFirst();

          let subscriberId: number;
          if (existing) {
            subscriberId = existing.id;
            // `attribs` is deliberately not gated on `overwrite_user_info` (which now
            // only covers `name`): the default `merge` has to be able to add keys to an
            // existing contact without clobbering the rest.
            const update = {
              ...(body.overwrite_user_info && s.name !== undefined ? { name: s.name } : {}),
              ...(s.attribs && body.attribs_mode !== "skip"
                ? { attribs: attribsAssignment(body.attribs_mode, s.attribs) }
                : {}),
              ...(s.tags?.length && body.tags_mode !== "skip"
                ? {
                    tags:
                      body.tags_mode === "replace"
                        ? s.tags
                        : sql<string[]>`(
                            SELECT COALESCE(array_agg(DISTINCT tag), '{}')
                            FROM unnest(tags || ${s.tags}::text[]) AS tag
                          )`,
                  }
                : {}),
            };
            if (Object.keys(update).length > 0) {
              await db
                .updateTable("subscribers")
                .set(update)
                .where("id", "=", subscriberId)
                .execute();
            }
            wasCreated = false;
          } else {
            // Goes through the service so an imported contact fires
            // `contact_created` like any other -- a large import therefore enrolls
            // every new contact, which is intended (see docs/plan/automations_v2.md).
            const { subscriber } = await createSubscriber(db, {
              email: s.email,
              name: s.name,
              attribs: s.attribs,
              tags: s.tags,
            });
            subscriberId = subscriber.id;
            wasCreated = true;
          }

          if (body.mode === "blocklist") {
            await blocklistSubscriber(db, subscriberId);
          } else {
            for (const listId of body.list_ids) {
              await addToListForImport(
                db,
                subscriberId,
                listId,
                body.status,
                body.overwrite_subscription_status,
              );
            }
          }
          // Counted only once the row is fully applied, lists included -- a
          // row that threw halfway is reported as failed, not as imported.
          if (wasCreated) created++;
          else updated++;
        } catch (err) {
          failed.push({
            email: s.email,
            error: err instanceof Error ? err.message : "import failed",
          });
        }
      }
      return { created, updated, failed };
    },
  );

  // --- Bulk endpoints ---

  app.post(
    "/api/v1/subscribers/bulk/blocklist",
    { preHandler: app.requirePermission("subscribers:manage") },
    async (req) => {
      const selector = BulkSelector.parse(req.body);
      const affected = await bulkBlocklist(db, selector);
      return { affected };
    },
  );

  app.post(
    "/api/v1/subscribers/bulk/delete",
    { preHandler: app.requirePermission("subscribers:manage") },
    async (req) => {
      const selector = BulkSelector.parse(req.body);
      const affected = await bulkDelete(db, selector);
      return { affected };
    },
  );

  const BulkListsBody = z
    .object({
      list_ids: z.array(z.number().int()).min(1),
      action: z.enum(["add", "remove"]),
      status: z.enum(["unconfirmed", "confirmed"]).optional(),
      // Off by default: one bulk change must not silently enrol thousands of
      // contacts in automations (see services/bulkActions.ts).
      trigger_automations: z.boolean().default(false),
    })
    .and(BulkSelector)
    .superRefine((data, ctx) => {
      if (data.action === "add" && !data.status) {
        ctx.addIssue({
          code: "custom",
          path: ["status"],
          message: "status is required when action is 'add'",
        });
      }
    });

  app.post(
    "/api/v1/subscribers/bulk/lists",
    { preHandler: app.requirePermission("subscribers:manage") },
    async (req) => {
      const body = BulkListsBody.parse(req.body);
      const selector: { ids: number[] } | { query: SubscriberFilter; all: true } =
        "ids" in body ? { ids: body.ids } : { query: body.query, all: true };
      const affected = await bulkLists(db, selector, body.list_ids, body.action, {
        status: body.status,
        triggerAutomations: body.trigger_automations,
      });
      return { affected };
    },
  );

  app.post(
    "/api/v1/subscribers/export",
    { preHandler: app.requirePermission("subscribers:get") },
    async (req, reply) => {
      const selector = BulkSelector.parse(req.body);
      const csv = await exportSubscribers(db, selector);
      reply.header("content-type", "text/csv");
      reply.header("content-disposition", 'attachment; filename="subscribers.csv"');
      return reply.send(csv);
    },
  );
}
