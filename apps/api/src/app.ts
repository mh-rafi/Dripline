import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import type pg from "pg";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import type { DB } from "./db/kysely.js";
import authPlugin from "./auth/plugin.js";
import { BadRequestError, HttpError } from "./lib/errors.js";

import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import roleRoutes from "./routes/roles.js";
import subscriberRoutes from "./routes/subscribers.js";
import listRoutes from "./routes/lists.js";
import templateRoutes from "./routes/templates.js";
import campaignRoutes from "./routes/campaigns.js";
import connectionRoutes from "./routes/connections.js";
import automationRoutes from "./routes/automations.js";
import bounceRoutes from "./routes/bounces.js";
import trackingRoutes from "./routes/tracking.js";

export function buildApp(pool: pg.Pool, db: DB, config: Config): FastifyInstance {
  // Fastify's types omit the hop-count form of trustProxy that proxy-addr (and
  // Fastify's own docs) accept, so a numeric TRUST_PROXY needs the cast.
  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: config.trustProxy as boolean | string,
    bodyLimit: config.bodyLimitBytes,
  });

  app.register(cors, { origin: true });
  app.register(authPlugin, { config, db });

  // Action-only endpoints (start/pause/enroll/...) are often called with no
  // body at all. Tolerate "Content-Type: application/json" with an empty
  // body instead of erroring, since plenty of HTTP clients send it anyway.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (body === "") return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch {
      // A bare SyntaxError carries no statusCode, so the error handler below
      // would report malformed JSON as a 500 rather than a 400.
      done(new BadRequestError("invalid JSON body"), undefined);
    }
  });

  // Silent: the container healthcheck polls this every 30s, and two log
  // lines per poll is ~6k lines a day that say nothing. Failures still
  // surface through the container's health status.
  app.get("/health", { logLevel: "silent" }, async () => {
    await pool.query("SELECT 1");
    return { status: "ok" };
  });

  // Unauthenticated on purpose: this is how the admin UI (and anyone else
  // interacting with the instance) is told where to get the source, which
  // AGPL-3.0 section 13 requires of a network-deployed modified version.
  app.get("/api/v1/meta", async () => ({
    version: config.version,
    source_url: config.sourceUrl,
    license: "AGPL-3.0-or-later",
  }));

  app.register(authRoutes, { db });
  app.register(userRoutes, { db });
  app.register(roleRoutes, { db });
  app.register(subscriberRoutes, { db });
  app.register(listRoutes, { db });
  app.register(templateRoutes, { db });
  app.register(connectionRoutes, { db });
  app.register(campaignRoutes, { db, config });
  app.register(automationRoutes, { db });
  app.register(bounceRoutes, { db });
  app.register(trackingRoutes, { db, config });

  // When a built admin UI is present this process serves it too, so a whole
  // install is one origin and one port -- which APP_URL depends on, since
  // tracking links (/api/v1/track/...) and the unsubscribe page (a client-side
  // route) are both reached through it.
  if (config.webDist) {
    const webDist = config.webDist;
    app.register(fastifyStatic, {
      root: webDist,
      // Vite fingerprints everything under assets/, so those are immutable;
      // index.html must never be cached or upgrades serve a stale shell
      // pointing at deleted bundles.
      setHeaders(reply, filePath) {
        const relative = path.relative(webDist, filePath);
        reply.header(
          "cache-control",
          relative.startsWith("assets" + path.sep)
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        );
      },
    });

    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith("/api/")) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  }

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
