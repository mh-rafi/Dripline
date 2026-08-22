import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import type { SmtpProviderConfig } from "../db/types.js";
import { NotFoundError } from "../lib/errors.js";
import { invalidateTransporter } from "../services/providerRouter.js";

const SmtpConfig = z.object({
  host: z.string().min(1),
  port: z.number().int(),
  secure: z.boolean().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
});
const CreateProvider = z.object({
  name: z.string().min(1),
  from_email: z.string().email(),
  weight: z.number().int().positive().default(1),
  enabled: z.boolean().default(true),
  max_errors: z.number().int().positive().default(20),
  config: SmtpConfig,
});
const UpdateProvider = CreateProvider.partial();

function mask<T extends { config: SmtpProviderConfig }>(provider: T) {
  return {
    ...provider,
    config: { ...provider.config, password: provider.config.password ? "••••••••" : undefined },
  };
}

export default async function providerRoutes(app: FastifyInstance, opts: { db: DB }) {
  const { db } = opts;
  app.addHook("preHandler", app.requireAuth);

  app.get("/api/v1/providers", async () => {
    const rows = await db.selectFrom("providers").selectAll().orderBy("id", "desc").execute();
    return rows.map(mask);
  });

  app.post("/api/v1/providers", async (req, reply) => {
    const body = CreateProvider.parse(req.body);
    const provider = await db
      .insertInto("providers")
      .values({ type: "smtp", ...body })
      .returningAll()
      .executeTakeFirstOrThrow();
    reply.code(201);
    return mask(provider);
  });

  app.patch("/api/v1/providers/:id", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    const body = UpdateProvider.parse(req.body);
    const provider = await db
      .updateTable("providers")
      .set(body)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    if (!provider) throw new NotFoundError("provider");
    invalidateTransporter(id);
    return mask(provider);
  });

  app.delete("/api/v1/providers/:id", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    await db.deleteFrom("providers").where("id", "=", id).execute();
    invalidateTransporter(id);
    return { ok: true };
  });

  app.post("/api/v1/providers/:id/enable", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    await db
      .updateTable("providers")
      .set({ enabled: true, error_count: 0, disabled_reason: null })
      .where("id", "=", id)
      .execute();
    return { ok: true };
  });
}
