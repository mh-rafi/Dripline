import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import { BadRequestError, ConflictError, NotFoundError } from "../lib/errors.js";
import { hashPassword } from "../lib/password.js";
import { generateApiKey } from "../lib/apiKeys.js";
import { SUPER_ADMIN_ROLE_ID } from "../lib/permissions.js";

const IdParam = z.object({ id: z.coerce.number() });

const Status = z.enum(["enabled", "disabled"]);

const CreateUser = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user"),
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8),
    role_id: z.number().int(),
    status: Status.default("enabled"),
  }),
  z.object({
    type: z.literal("api"),
    name: z.string().min(1),
    role_id: z.number().int(),
    status: Status.default("enabled"),
  }),
]);

const UpdateUser = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  role_id: z.number().int().optional(),
  status: Status.optional(),
});

const USER_COLUMNS = [
  "users.id",
  "users.name",
  "users.email",
  "users.type",
  "users.role_id",
  "roles.name as role_name",
  "users.status",
  "users.api_key_prefix",
  "users.last_used_at",
  "users.created_at",
  "users.updated_at",
] as const;

function usersQuery(db: DB) {
  return db.selectFrom("users").innerJoin("roles", "roles.id", "users.role_id");
}

/** Guards against removing the instance's last enabled Super Admin --
 * checked whenever a change would demote, disable, or delete one. */
async function assertSuperAdminSurvives(db: DB, excludeUserId: number) {
  const others = await db
    .selectFrom("users")
    .select(db.fn.countAll<string>().as("count"))
    .where("role_id", "=", SUPER_ADMIN_ROLE_ID)
    .where("status", "=", "enabled")
    .where("id", "!=", excludeUserId)
    .executeTakeFirstOrThrow();
  if (Number(others.count) === 0) {
    throw new ConflictError("at least one enabled Super Admin must remain");
  }
}

export default async function userRoutes(app: FastifyInstance, opts: { db: DB }) {
  const { db } = opts;
  app.addHook("preHandler", app.requireAuth);

  app.get("/api/v1/users", { preHandler: app.requirePermission("users:get") }, async () =>
    usersQuery(db).select(USER_COLUMNS).orderBy("users.id", "desc").execute(),
  );

  app.get("/api/v1/users/:id", { preHandler: app.requirePermission("users:get") }, async (req) => {
    const { id } = IdParam.parse(req.params);
    const user = await usersQuery(db)
      .select(USER_COLUMNS)
      .where("users.id", "=", id)
      .executeTakeFirst();
    if (!user) throw new NotFoundError("user");
    return user;
  });

  app.post(
    "/api/v1/users",
    { preHandler: app.requirePermission("users:manage") },
    async (req, reply) => {
      const body = CreateUser.parse(req.body);

      let token: string | null = null;
      let inserted: { id: number };
      if (body.type === "user") {
        inserted = await db
          .insertInto("users")
          .values({
            name: body.name,
            type: "user",
            email: body.email,
            password_hash: await hashPassword(body.password),
            role_id: body.role_id,
            status: body.status,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
      } else {
        const generated = generateApiKey();
        token = generated.plain;
        inserted = await db
          .insertInto("users")
          .values({
            name: body.name,
            type: "api",
            role_id: body.role_id,
            status: body.status,
            api_key_prefix: generated.prefix,
            api_key_hash: generated.hash,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
      }

      const user = await usersQuery(db)
        .select(USER_COLUMNS)
        .where("users.id", "=", inserted.id)
        .executeTakeFirstOrThrow();
      reply.code(201);
      // The plaintext token is only ever shown here, once.
      return token ? { ...user, token } : user;
    },
  );

  app.patch(
    "/api/v1/users/:id",
    { preHandler: app.requirePermission("users:manage") },
    async (req) => {
      const { id } = IdParam.parse(req.params);
      const body = UpdateUser.parse(req.body);

      const existing = await db
        .selectFrom("users")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      if (!existing) throw new NotFoundError("user");

      if (existing.type === "api" && (body.email !== undefined || body.password !== undefined)) {
        throw new BadRequestError("API users don't have an email or password");
      }

      const wasSuperAdmin =
        existing.role_id === SUPER_ADMIN_ROLE_ID && existing.status === "enabled";
      const losesSuperAdmin =
        wasSuperAdmin &&
        ((body.role_id !== undefined && body.role_id !== SUPER_ADMIN_ROLE_ID) ||
          (body.status !== undefined && body.status !== "enabled"));
      if (losesSuperAdmin) await assertSuperAdminSurvives(db, id);

      const user = await db
        .updateTable("users")
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.email !== undefined ? { email: body.email } : {}),
          ...(body.password !== undefined
            ? { password_hash: await hashPassword(body.password) }
            : {}),
          ...(body.role_id !== undefined ? { role_id: body.role_id } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
        })
        .where("id", "=", id)
        .returning("id")
        .executeTakeFirst();
      if (!user) throw new NotFoundError("user");

      return usersQuery(db)
        .select(USER_COLUMNS)
        .where("users.id", "=", id)
        .executeTakeFirstOrThrow();
    },
  );

  app.post(
    "/api/v1/users/:id/regenerate-token",
    { preHandler: app.requirePermission("users:manage") },
    async (req) => {
      const { id } = IdParam.parse(req.params);
      const existing = await db
        .selectFrom("users")
        .select(["id", "type"])
        .where("id", "=", id)
        .executeTakeFirst();
      if (!existing) throw new NotFoundError("user");
      if (existing.type !== "api") throw new BadRequestError("only API users have a token");

      const generated = generateApiKey();
      // Overwriting the prefix/hash invalidates the old token immediately.
      await db
        .updateTable("users")
        .set({ api_key_prefix: generated.prefix, api_key_hash: generated.hash })
        .where("id", "=", id)
        .execute();

      const user = await usersQuery(db)
        .select(USER_COLUMNS)
        .where("users.id", "=", id)
        .executeTakeFirstOrThrow();
      return { ...user, token: generated.plain };
    },
  );

  app.delete(
    "/api/v1/users/:id",
    { preHandler: app.requirePermission("users:manage") },
    async (req) => {
      const { id } = IdParam.parse(req.params);
      const existing = await db
        .selectFrom("users")
        .select(["role_id", "status"])
        .where("id", "=", id)
        .executeTakeFirst();
      if (!existing) throw new NotFoundError("user");
      if (existing.role_id === SUPER_ADMIN_ROLE_ID && existing.status === "enabled") {
        await assertSuperAdminSurvives(db, id);
      }
      await db.deleteFrom("users").where("id", "=", id).execute();
      return { ok: true };
    },
  );
}
