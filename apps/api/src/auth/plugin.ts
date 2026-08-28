import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import type { DB } from "../db/kysely.js";
import { extractPrefix, hashApiKey } from "../lib/apiKeys.js";
import type { Permission } from "../lib/permissions.js";
import { SUPER_ADMIN_ROLE_ID } from "../lib/permissions.js";

export interface AuthUser {
  id: number;
  type: "user" | "api";
  role_id: number;
  permissions: Permission[];
  passwordChangedAt: Date | null;
}

declare module "fastify" {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (
      perm: Permission,
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    authUser?: AuthUser;
    authMethod?: "jwt" | "apiKey";
  }
}

export default fp(async function authPlugin(
  app: FastifyInstance,
  opts: { config: Config; db: DB },
) {
  const { config, db } = opts;

  await app.register(jwt, { secret: config.jwtSecret });

  async function loadUser(id: number): Promise<AuthUser | null> {
    const row = await db
      .selectFrom("users")
      .innerJoin("roles", "roles.id", "users.role_id")
      .select([
        "users.id",
        "users.type",
        "users.role_id",
        "users.status",
        "users.password_changed_at",
        "roles.permissions as role_permissions",
      ])
      .where("users.id", "=", id)
      .executeTakeFirst();
    if (!row || row.status !== "enabled") return null;
    return {
      id: row.id,
      type: row.type,
      role_id: row.role_id,
      permissions: row.role_permissions as Permission[],
      passwordChangedAt: row.password_changed_at ? new Date(row.password_changed_at) : null,
    };
  }

  /** A JWT minted before the account's password last changed is dead, so a
   * reset (or a change made because a session was stolen) actually evicts the
   * other sessions instead of leaving them valid for the rest of their 30
   * days. `iat` is whole seconds, so the comparison floors both sides --
   * otherwise the replacement token handed out by the very request that
   * changed the password could be rejected by its own sub-second timing. */
  function issuedBeforePasswordChange(user: AuthUser, issuedAt: number | undefined): boolean {
    if (!user.passwordChangedAt) return false;
    if (issuedAt === undefined) return true;
    return issuedAt < Math.floor(user.passwordChangedAt.getTime() / 1000);
  }

  app.decorate("requireAuth", async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "missing bearer token" });
    }
    const token = header.slice("Bearer ".length);

    const prefix = extractPrefix(token);
    if (prefix) {
      const row = await db
        .selectFrom("users")
        .select(["id", "api_key_hash"])
        .where("api_key_prefix", "=", prefix)
        .where("type", "=", "api")
        .executeTakeFirst();
      if (!row?.api_key_hash || row.api_key_hash !== hashApiKey(token)) {
        return reply.code(401).send({ error: "invalid API key" });
      }
      const user = await loadUser(row.id);
      if (!user) return reply.code(401).send({ error: "user disabled" });
      await db
        .updateTable("users")
        .set({ last_used_at: new Date() })
        .where("id", "=", row.id)
        .execute();
      req.authUser = user;
      req.authMethod = "apiKey";
      return;
    }

    try {
      const payload = app.jwt.verify<{ sub: number; iat?: number }>(token);
      const user = await loadUser(payload.sub);
      if (!user) return reply.code(401).send({ error: "user disabled" });
      if (issuedBeforePasswordChange(user, payload.iat)) {
        return reply.code(401).send({ error: "password changed -- sign in again" });
      }
      req.authUser = user;
      req.authMethod = "jwt";
    } catch {
      return reply.code(401).send({ error: "invalid or expired session" });
    }
  });

  app.decorate("requirePermission", (perm: Permission) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.authUser;
      if (!user) return reply.code(401).send({ error: "missing bearer token" });
      if (user.role_id === SUPER_ADMIN_ROLE_ID) return;
      if (!user.permissions.includes(perm)) {
        return reply.code(403).send({ error: `missing permission: ${perm}` });
      }
    };
  });
});
