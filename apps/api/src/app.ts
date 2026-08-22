import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type pg from "pg";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import type { DB } from "./db/kysely.js";
import authPlugin from "./auth/plugin.js";
import { HttpError } from "./lib/errors.js";

import authRoutes from "./routes/auth.js";
import subscriberRoutes from "./routes/subscribers.js";
import listRoutes from "./routes/lists.js";
import templateRoutes from "./routes/templates.js";
import campaignRoutes from "./routes/campaigns.js";
import connectionRoutes from "./routes/connections.js";
import workflowRoutes from "./routes/workflows.js";
import webhookRoutes from "./routes/webhooks.js";
import bounceRoutes from "./routes/bounces.js";
import trackingRoutes from "./routes/tracking.js";

export function buildApp(pool: pg.Pool, db: DB, config: Config): FastifyInstance {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });
  app.register(authPlugin, { config, db });

  // Action-only endpoints (start/pause/enroll/...) are often called with no
  // body at all. Tolerate "Content-Type: application/json" with an empty
  // body instead of erroring, since plenty of HTTP clients send it anyway.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (body === "") return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get("/health", async () => {
    await pool.query("SELECT 1");
    return { status: "ok" };
  });

  app.register(authRoutes, { db });
  app.register(subscriberRoutes, { db });
  app.register(listRoutes, { db });
  app.register(templateRoutes, { db });
  app.register(connectionRoutes, { db });
  app.register(campaignRoutes, { db, config });
  app.register(workflowRoutes, { db });
  app.register(webhookRoutes, { db });
  app.register(bounceRoutes, { db });
  app.register(trackingRoutes, { db, config });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.message });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "validation failed", issues: err.issues });
    }
    app.log.error(err);
    return reply.code(500).send({ error: "internal server error" });
  });

  return app;
}
