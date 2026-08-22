import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import { NotFoundError } from "../lib/errors.js";

const CreateTemplate = z.object({
  name: z.string().min(1),
  subject: z.string().optional(),
  body: z.string().min(1),
  is_default: z.boolean().optional(),
});
const UpdateTemplate = CreateTemplate.partial();

export default async function templateRoutes(app: FastifyInstance, opts: { db: DB }) {
  const { db } = opts;
  app.addHook("preHandler", app.requireAuth);

  app.get("/api/v1/templates", async () =>
    db.selectFrom("templates").selectAll().orderBy("id", "desc").execute(),
  );

  app.get("/api/v1/templates/:id", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    const template = await db
      .selectFrom("templates")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!template) throw new NotFoundError("template");
    return template;
  });

  app.post("/api/v1/templates", async (req, reply) => {
    const body = CreateTemplate.parse(req.body);
    const template = await db
      .insertInto("templates")
      .values({
        name: body.name,
        subject: body.subject ?? "",
        body: body.body,
        is_default: body.is_default ?? false,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    reply.code(201);
    return template;
  });

  app.patch("/api/v1/templates/:id", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    const body = UpdateTemplate.parse(req.body);
    const template = await db
      .updateTable("templates")
      .set(body)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    if (!template) throw new NotFoundError("template");
    return template;
  });

  app.delete("/api/v1/templates/:id", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    await db.deleteFrom("templates").where("id", "=", id).execute();
    return { ok: true };
  });
}
