import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { generateApiKey } from "../lib/apiKeys.js";

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });
const SetupBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});
const ApiKeyBody = z.object({ name: z.string().min(1) });

export default async function authRoutes(app: FastifyInstance, opts: { db: DB }) {
  const { db } = opts;

  // First-run setup: only works while there are zero admin users.
  app.post("/api/v1/auth/setup", async (req, reply) => {
    const body = SetupBody.parse(req.body);
    const existing = await db.selectFrom("users").select("id").executeTakeFirst();
    if (existing) {
      return reply.code(409).send({ error: "an admin user already exists" });
    }
    const passwordHash = await hashPassword(body.password);
    const user = await db
      .insertInto("users")
      .values({ email: body.email, password_hash: passwordHash, name: body.name ?? "" })
      .returning(["id", "email", "name"])
      .executeTakeFirstOrThrow();
    const token = app.jwt.sign({ sub: user.id }, { expiresIn: "30d" });
    return { token, user };
  });

  app.post("/api/v1/auth/login", async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const user = await db
      .selectFrom("users")
      .selectAll()
      .where("email", "=", body.email)
      .executeTakeFirst();
    if (!user || !(await verifyPassword(body.password, user.password_hash))) {
      return reply.code(401).send({ error: "invalid email or password" });
    }
    const token = app.jwt.sign({ sub: user.id }, { expiresIn: "30d" });
    return { token, user: { id: user.id, email: user.email, name: user.name } };
  });

  app.get("/api/v1/auth/me", { preHandler: app.requireAuth }, async (req, reply) => {
    if (!req.userId) return reply.code(403).send({ error: "admin session required" });
    const user = await db
      .selectFrom("users")
      .select(["id", "email", "name"])
      .where("id", "=", req.userId)
      .executeTakeFirst();
    return user;
  });

  app.get("/api/v1/api-keys", { preHandler: app.requireAuth }, async () => {
    return db
      .selectFrom("api_keys")
      .select(["id", "name", "key_prefix", "last_used_at", "created_at"])
      .execute();
  });

  app.post("/api/v1/api-keys", { preHandler: app.requireAuth }, async (req) => {
    const body = ApiKeyBody.parse(req.body);
    const generated = generateApiKey();
    const row = await db
      .insertInto("api_keys")
      .values({ name: body.name, key_prefix: generated.prefix, key_hash: generated.hash })
      .returning(["id", "name", "key_prefix", "created_at"])
      .executeTakeFirstOrThrow();
    // The plaintext key is only ever shown once, here.
    return { ...row, key: generated.plain };
  });

  app.delete("/api/v1/api-keys/:id", { preHandler: app.requireAuth }, async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    await db.deleteFrom("api_keys").where("id", "=", id).execute();
    return { ok: true };
  });
}
