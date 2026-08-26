import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import { BadRequestError, ConflictError, NotFoundError } from "../lib/errors.js";
import { ALL_PERMISSIONS, isPermission, SUPER_ADMIN_ROLE_ID } from "../lib/permissions.js";

const IdParam = z.object({ id: z.coerce.number() });

const Permissions = z
  .array(z.string())
  .default([])
  .refine((perms) => perms.every(isPermission), { message: "unknown permission" });

const CreateRole = z.object({
  name: z.string().min(1),
  permissions: Permissions,
});
const UpdateRole = CreateRole.partial();

export default async function roleRoutes(app: FastifyInstance, opts: { db: DB }) {
  const { db } = opts;
  app.addHook("preHandler", app.requireAuth);

  app.get("/api/v1/roles", { preHandler: app.requirePermission("roles:get") }, async () =>
    db.selectFrom("roles").selectAll().orderBy("id", "asc").execute(),
  );

  app.get(
    "/api/v1/roles/permissions",
    { preHandler: app.requirePermission("roles:get") },
    async () => ALL_PERMISSIONS,
  );

  app.get("/api/v1/roles/:id", { preHandler: app.requirePermission("roles:get") }, async (req) => {
    const { id } = IdParam.parse(req.params);
    const role = await db.selectFrom("roles").selectAll().where("id", "=", id).executeTakeFirst();
    if (!role) throw new NotFoundError("role");
    return role;
  });

  app.post(
    "/api/v1/roles",
    { preHandler: app.requirePermission("roles:manage") },
    async (req, reply) => {
      const body = CreateRole.parse(req.body);
      const role = await db
        .insertInto("roles")
        .values({ type: "user", name: body.name, permissions: body.permissions })
        .returningAll()
        .executeTakeFirstOrThrow();
      reply.code(201);
      return role;
    },
  );

  app.patch(
    "/api/v1/roles/:id",
    { preHandler: app.requirePermission("roles:manage") },
    async (req) => {
      const { id } = IdParam.parse(req.params);
      if (id === SUPER_ADMIN_ROLE_ID) {
        throw new BadRequestError("the Super Admin role can't be edited");
      }
      const body = UpdateRole.parse(req.body);
      const role = await db
        .updateTable("roles")
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.permissions !== undefined ? { permissions: body.permissions } : {}),
        })
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();
      if (!role) throw new NotFoundError("role");
      return role;
    },
  );

  app.delete(
    "/api/v1/roles/:id",
    { preHandler: app.requirePermission("roles:manage") },
    async (req) => {
      const { id } = IdParam.parse(req.params);
      if (id === SUPER_ADMIN_ROLE_ID) {
        throw new BadRequestError("the Super Admin role can't be deleted");
      }
      try {
        await db.deleteFrom("roles").where("id", "=", id).execute();
      } catch (err) {
        // FK RESTRICT on users.role_id -- surfaced as a Postgres error when
        // the role is still assigned to at least one user.
        if (err instanceof Object && "code" in err && err.code === "23503") {
          throw new ConflictError("this role is still assigned to one or more users");
        }
        throw err;
      }
      return { ok: true };
    },
  );
}
