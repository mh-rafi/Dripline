import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import type { DB } from "../db/kysely.js";
import { BadRequestError } from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { SUPER_ADMIN_ROLE_ID } from "../lib/permissions.js";
import {
  purgeExpiredResetTokens,
  requestPasswordReset,
  resetPassword,
  setPassword,
} from "../services/passwordReset.js";

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });
const SetupBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});
const ChangePasswordBody = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8),
});
const ForgotPasswordBody = z.object({ email: z.string().email() });
const ResetPasswordBody = z.object({ token: z.string().min(1), password: z.string().min(8) });

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

export default async function authRoutes(app: FastifyInstance, opts: { db: DB; config: Config }) {
  const { db, config } = opts;

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

  // Changing your own password needs no permission beyond being signed in --
  // gating it on `users:manage` would lock every non-admin out of their own
  // account. Editing *someone else's* stays on PATCH /users/:id.
  app.post("/api/v1/auth/password", { preHandler: app.requireAuth }, async (req, reply) => {
    const authUser = req.authUser;
    if (!authUser) return reply.code(401).send({ error: "missing bearer token" });
    if (req.authMethod !== "jwt") {
      return reply.code(403).send({ error: "password changes require a signed-in session" });
    }
    const body = ChangePasswordBody.parse(req.body);

    const row = await db
      .selectFrom("users")
      .select(["id", "password_hash", "type"])
      .where("id", "=", authUser.id)
      .executeTakeFirstOrThrow();
    if (row.type !== "user" || !row.password_hash) {
      throw new BadRequestError("this account has no password");
    }
    if (!(await verifyPassword(body.current_password, row.password_hash))) {
      return reply.code(401).send({ error: "current password is incorrect" });
    }

    await setPassword(db, authUser.id, body.new_password);
    // Every other session is now invalid (see auth/plugin.ts), including the
    // one that made this call -- so it is handed a replacement rather than
    // being signed out for changing its own password.
    return { token: app.jwt.sign({ sub: authUser.id }, { expiresIn: "30d" }) };
  });

  // Unauthenticated, and deliberately constant in its response: it says the
  // same thing whether or not the address has an account, so it can't be used
  // to find out who has one.
  app.post("/api/v1/auth/forgot-password", async (req) => {
    const body = ForgotPasswordBody.parse(req.body);
    await purgeExpiredResetTokens(db);
    try {
      await requestPasswordReset(db, config, body.email);
    } catch (err) {
      // A misconfigured or failing system connection must not become a signal
      // about which addresses exist, so it is logged and swallowed. The admin
      // sees it through the test button in Settings → System.
      app.log.error({ err }, "password reset email failed");
    }
    return { ok: true };
  });

  app.post("/api/v1/auth/reset-password", async (req) => {
    const body = ResetPasswordBody.parse(req.body);
    await resetPassword(db, body.token, body.password);
    return { ok: true };
  });
}
