import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import {
  addTag,
  addToList,
  blocklistSubscriber,
  getSubscriberOrThrow,
  removeFromList,
  removeTag,
} from "../services/subscribers.js";

const CreateSubscriber = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  attribs: z.record(z.unknown()).optional(),
  list_ids: z.array(z.number().int()).optional(),
});
const UpdateSubscriber = z.object({
  name: z.string().optional(),
  attribs: z.record(z.unknown()).optional(),
});
const ListQuery = z.object({
  q: z.string().optional(),
  list_id: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export default async function subscriberRoutes(app: FastifyInstance, opts: { db: DB }) {
  const { db } = opts;
  app.addHook("preHandler", app.requireAuth);

  app.get("/api/v1/subscribers", async (req) => {
    const query = ListQuery.parse(req.query);
    let builder = db
      .selectFrom("subscribers")
      .selectAll()
      .orderBy("id", "desc")
      .limit(query.limit)
      .offset(query.offset);
    if (query.q) {
      builder = builder.where((eb) =>
        eb.or([eb("email", "ilike", `%${query.q}%`), eb("name", "ilike", `%${query.q}%`)]),
      );
    }
    if (query.list_id) {
      builder = builder.where((eb) =>
        eb(
          "subscribers.id",
          "in",
          eb
            .selectFrom("subscriber_lists")
            .select("subscriber_id")
            .where("list_id", "=", query.list_id!),
        ),
      );
    }
    return builder.execute();
  });

  app.get("/api/v1/subscribers/:id", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    const subscriber = await getSubscriberOrThrow(db, id);
    const lists = await db
      .selectFrom("subscriber_lists")
      .innerJoin("lists", "lists.id", "subscriber_lists.list_id")
      .select(["lists.id", "lists.name", "subscriber_lists.status"])
      .where("subscriber_id", "=", id)
      .execute();
    return { ...subscriber, lists };
  });

  app.post("/api/v1/subscribers", async (req, reply) => {
    const body = CreateSubscriber.parse(req.body);
    const subscriber = await db
      .insertInto("subscribers")
      .values({ email: body.email, name: body.name ?? "", attribs: body.attribs ?? {} })
      .onConflict((oc) => oc.column("email").doUpdateSet({ name: body.name ?? "" }))
      .returningAll()
      .executeTakeFirstOrThrow();

    for (const listId of body.list_ids ?? []) {
      await addToList(db, subscriber.id, listId);
    }
    reply.code(201);
    return subscriber;
  });

  app.patch("/api/v1/subscribers/:id", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    const body = UpdateSubscriber.parse(req.body);
    await getSubscriberOrThrow(db, id);
    return db
      .updateTable("subscribers")
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.attribs ? { attribs: body.attribs } : {}),
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
  });

  app.delete("/api/v1/subscribers/:id", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    await db.deleteFrom("subscribers").where("id", "=", id).execute();
    return { ok: true };
  });

  app.post("/api/v1/subscribers/:id/blocklist", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    await blocklistSubscriber(db, id);
    return { ok: true };
  });

  app.put("/api/v1/subscribers/:id/lists/:listId", async (req) => {
    const { id, listId } = z
      .object({ id: z.coerce.number(), listId: z.coerce.number() })
      .parse(req.params);
    const { status } = z
      .object({ status: z.enum(["unconfirmed", "confirmed"]).default("unconfirmed") })
      .parse(req.body ?? {});
    await addToList(db, id, listId, status);
    return { ok: true };
  });

  app.delete("/api/v1/subscribers/:id/lists/:listId", async (req) => {
    const { id, listId } = z
      .object({ id: z.coerce.number(), listId: z.coerce.number() })
      .parse(req.params);
    await removeFromList(db, id, listId);
    return { ok: true };
  });

  app.put("/api/v1/subscribers/:id/tags/:tag", async (req) => {
    const { id, tag } = z.object({ id: z.coerce.number(), tag: z.string() }).parse(req.params);
    await addTag(db, id, tag);
    return { ok: true };
  });

  app.delete("/api/v1/subscribers/:id/tags/:tag", async (req) => {
    const { id, tag } = z.object({ id: z.coerce.number(), tag: z.string() }).parse(req.params);
    await removeTag(db, id, tag);
    return { ok: true };
  });

  app.post("/api/v1/subscribers/import", async (req) => {
    const body = z
      .object({
        list_ids: z.array(z.number().int()).default([]),
        subscribers: z.array(
          z.object({
            email: z.string().email(),
            name: z.string().optional(),
            attribs: z.record(z.unknown()).optional(),
          }),
        ),
      })
      .parse(req.body);

    let imported = 0;
    for (const s of body.subscribers) {
      const row = await db
        .insertInto("subscribers")
        .values({ email: s.email, name: s.name ?? "", attribs: s.attribs ?? {} })
        .onConflict((oc) => oc.column("email").doUpdateSet({ name: s.name ?? "" }))
        .returning("id")
        .executeTakeFirstOrThrow();
      for (const listId of body.list_ids) await addToList(db, row.id, listId);
      imported++;
    }
    return { imported };
  });
}
