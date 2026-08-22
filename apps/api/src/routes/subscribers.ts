import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import {
  addTag,
  addToList,
  addToListForImport,
  blocklistSubscriber,
  getSubscriberOrThrow,
  removeFromList,
  removeTag,
  unblocklistSubscriber,
} from "../services/subscribers.js";

const CreateSubscriber = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  status: z.enum(["enabled", "blocklisted"]).default("enabled"),
  attribs: z.record(z.unknown()).optional(),
  list_ids: z.array(z.number().int()).optional(),
  // Matches listmonk's "Preconfirm subscriptions" checkbox: mark all of the
  // given lists as 'confirmed' immediately (bypassing the usual
  // single-vs-double-opt-in default) instead of sending/needing a
  // confirmation. Useful for known-good imports of already-consented lists.
  preconfirm: z.boolean().default(false),
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
      .select(["lists.id", "lists.name", "lists.optin", "subscriber_lists.status"])
      .where("subscriber_id", "=", id)
      .execute();
    return { ...subscriber, lists };
  });

  app.post("/api/v1/subscribers", async (req, reply) => {
    const body = CreateSubscriber.parse(req.body);
    let subscriber = await db
      .insertInto("subscribers")
      .values({ email: body.email, name: body.name ?? "", attribs: body.attribs ?? {} })
      .onConflict((oc) => oc.column("email").doUpdateSet({ name: body.name ?? "" }))
      .returningAll()
      .executeTakeFirstOrThrow();

    for (const listId of body.list_ids ?? []) {
      await addToList(db, subscriber.id, listId, body.preconfirm ? "confirmed" : undefined);
    }

    if (body.status === "blocklisted") {
      await blocklistSubscriber(db, subscriber.id);
      subscriber = await getSubscriberOrThrow(db, subscriber.id);
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

  app.post("/api/v1/subscribers/:id/unblocklist", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    await unblocklistSubscriber(db, id);
    return { ok: true };
  });

  app.put("/api/v1/subscribers/:id/lists/:listId", async (req) => {
    const { id, listId } = z
      .object({ id: z.coerce.number(), listId: z.coerce.number() })
      .parse(req.params);
    // No default here -- omitting `status` lets addToList pick the sensible
    // one for the list's opt-in type (confirmed for single, unconfirmed for
    // double), rather than always forcing "unconfirmed".
    const { status } = z
      .object({ status: z.enum(["unconfirmed", "confirmed"]).optional() })
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

  const ImportBody = z.object({
    mode: z.enum(["subscribe", "blocklist"]).default("subscribe"),
    // Only applies in "subscribe" mode -- the status given to every list
    // membership created by this import, overriding the usual
    // opt-in-type default (see addToListForImport).
    status: z.enum(["unconfirmed", "confirmed"]).default("confirmed"),
    list_ids: z.array(z.number().int()).default([]),
    overwrite_user_info: z.boolean().default(false),
    overwrite_subscription_status: z.boolean().default(false),
    subscribers: z.array(
      z.object({
        email: z.string().email(),
        name: z.string().optional(),
        attribs: z.record(z.unknown()).optional(),
      }),
    ),
  });

  app.post("/api/v1/subscribers/import", async (req) => {
    const body = ImportBody.parse(req.body);

    let imported = 0;
    for (const s of body.subscribers) {
      const existing = await db
        .selectFrom("subscribers")
        .select("id")
        .where("email", "=", s.email)
        .executeTakeFirst();

      let subscriberId: number;
      if (existing) {
        subscriberId = existing.id;
        if (body.overwrite_user_info) {
          await db
            .updateTable("subscribers")
            .set({
              ...(s.name !== undefined ? { name: s.name } : {}),
              ...(s.attribs ? { attribs: s.attribs } : {}),
            })
            .where("id", "=", subscriberId)
            .execute();
        }
      } else {
        const row = await db
          .insertInto("subscribers")
          .values({ email: s.email, name: s.name ?? "", attribs: s.attribs ?? {} })
          .returning("id")
          .executeTakeFirstOrThrow();
        subscriberId = row.id;
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
      imported++;
    }
    return { imported };
  });
}
