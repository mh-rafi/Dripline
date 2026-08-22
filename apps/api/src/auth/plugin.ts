import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import type { DB } from "../db/kysely.js";
import { extractPrefix, hashApiKey } from "../lib/apiKeys.js";

declare module "fastify" {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    userId?: number;
    authMethod?: "jwt" | "apiKey";
  }
}

export default fp(async function authPlugin(
  app: FastifyInstance,
  opts: { config: Config; db: DB },
) {
  const { config, db } = opts;

  await app.register(jwt, { secret: config.jwtSecret });

  app.decorate("requireAuth", async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "missing bearer token" });
    }
    const token = header.slice("Bearer ".length);

    const prefix = extractPrefix(token);
    if (prefix) {
      const key = await db
        .selectFrom("api_keys")
        .selectAll()
        .where("key_prefix", "=", prefix)
        .executeTakeFirst();
      if (!key || key.key_hash !== hashApiKey(token)) {
        return reply.code(401).send({ error: "invalid API key" });
      }
      await db
        .updateTable("api_keys")
        .set({ last_used_at: new Date() })
        .where("id", "=", key.id)
        .execute();
      req.authMethod = "apiKey";
      return;
    }

    try {
      const payload = app.jwt.verify<{ sub: number }>(token);
      req.userId = payload.sub;
      req.authMethod = "jwt";
    } catch {
      return reply.code(401).send({ error: "invalid or expired session" });
    }
  });
});
