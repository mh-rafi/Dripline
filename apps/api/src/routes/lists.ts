import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import { NotFoundError } from "../lib/errors.js";

const CreateList = z.object({
  name: z.string().min(1),
  type: z.enum(["public", "private"]).default("private"),
  optin: z.enum(["single", "double"]).default("single"),
  description: z.string().optional(),
});
// Plain `.partial()` would keep `type`/`optin`'s `.default(...)` active, so
// an omitted field would parse to the create-time default instead of
// `undefined` -- the PATCH handler's `.set(body)` would then silently reset
// e.g. a public list back to private on any edit that doesn't repeat `type`.
const UpdateList = CreateList.partial().extend({
  type: z.enum(["public", "private"]).optional(),
  optin: z.enum(["single", "double"]).optional(),
});

export default async function listRoutes(app: FastifyInstance, opts: { db: DB }) {
  const { db } = opts;
  app.addHook("preHandler", app.requireAuth);

  app.get("/api/v1/lists", { preHandler: app.requirePermission("lists:get") }, async () => {
    return db
      .selectFrom("lists")
      .selectAll()
      .select((eb) => [
        eb
          .selectFrom("subscriber_lists")
          .select((e) => e.fn.countAll().as("count"))
          .whereRef("subscriber_lists.list_id", "=", "lists.id")
          .as("subscriber_count"),
        eb
          .selectFrom("subscriber_lists")
          .select((e) => e.fn.countAll().as("count"))
          .whereRef("subscriber_lists.list_id", "=", "lists.id")
          .where("subscriber_lists.status", "=", "unsubscribed")
          .as("unsubscribed_count"),
      ])
      .orderBy("id", "desc")
      .execute();
  });

  app.get("/api/v1/lists/:id", { preHandler: app.requirePermission("lists:get") }, async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    const list = await db.selectFrom("lists").selectAll().where("id", "=", id).executeTakeFirst();
    if (!list) throw new NotFoundError("list");
    return list;
  });

  app.post(
    "/api/v1/lists",
    { preHandler: app.requirePermission("lists:manage") },
    async (req, reply) => {
      const body = CreateList.parse(req.body);
      const list = await db
        .insertInto("lists")
        .values(body)
        .returningAll()
        .executeTakeFirstOrThrow();
      reply.code(201);
      return list;
    },
  );

  app.patch(
    "/api/v1/lists/:id",
    { preHandler: app.requirePermission("lists:manage") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      const body = UpdateList.parse(req.body);
      const list = await db
        .updateTable("lists")
        .set(body)
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();
      if (!list) throw new NotFoundError("list");
      return list;
    },
  );

  app.delete(
    "/api/v1/lists/:id",
    { preHandler: app.requirePermission("lists:manage") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      await db.deleteFrom("lists").where("id", "=", id).execute();
      return { ok: true };
    },
  );
}
