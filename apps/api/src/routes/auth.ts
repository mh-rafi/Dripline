import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { SUPER_ADMIN_ROLE_ID } from "../lib/permissions.js";

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });
const SetupBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});

const PROFILE_COLUMNS = [
  "users.id",
  "users.email",
  "users.name",
  "users.type",
  "users.role_id",
  "roles.name as role_name",
  "users.status",
] as const;

function profileQuery(db: DB) {
  return db.selectFrom("users").innerJoin("roles", "roles.id", "users.role_id");
}

export default async function authRoutes(app: FastifyInstance, opts: { db: DB }) {
  const { db } = opts;

  // First-run setup: only works while there are zero admin users. The
  // account created here is always the primordial Super Admin.
  app.post("/api/v1/auth/setup", async (req, reply) => {
    const body = SetupBody.parse(req.body);
    const existing = await db.selectFrom("users").select("id").executeTakeFirst();
    if (existing) {
      return reply.code(409).send({ error: "an admin user already exists" });
    }
    const passwordHash = await hashPassword(body.password);
    const inserted = await db
      .insertInto("users")
      .values({
        email: body.email,
        password_hash: passwordHash,
        name: body.name ?? "",
        role_id: SUPER_ADMIN_ROLE_ID,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const user = await profileQuery(db)
      .select(PROFILE_COLUMNS)
      .where("users.id", "=", inserted.id)
      .executeTakeFirstOrThrow();
    const token = app.jwt.sign({ sub: user.id }, { expiresIn: "30d" });
    return { token, user };
  });

  app.post("/api/v1/auth/login", async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const row = await db
      .selectFrom("users")
      .selectAll()
      .where("email", "=", body.email)
      .where("type", "=", "user")
      .executeTakeFirst();
    if (!row || !row.password_hash || !(await verifyPassword(body.password, row.password_hash))) {
      return reply.code(401).send({ error: "invalid email or password" });
    }
    if (row.status !== "enabled") {
      return reply.code(403).send({ error: "this account has been disabled" });
    }
    const user = await profileQuery(db)
      .select(PROFILE_COLUMNS)
      .where("users.id", "=", row.id)
      .executeTakeFirstOrThrow();
    const token = app.jwt.sign({ sub: user.id }, { expiresIn: "30d" });
    return { token, user };
  });

  app.get("/api/v1/auth/me", { preHandler: app.requireAuth }, async (req, reply) => {
    if (!req.authUser) return reply.code(403).send({ error: "admin session required" });
    return profileQuery(db)
      .select(PROFILE_COLUMNS)
      .where("users.id", "=", req.authUser.id)
      .executeTakeFirst();
  });
}
