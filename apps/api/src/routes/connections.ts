import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import type {
  ConnectionConfig,
  ConnectionType,
  SesConnectionConfig,
  SmtpConnectionConfig,
} from "../db/types.js";
import { NotFoundError } from "../lib/errors.js";
import {
  createSender,
  type Connection,
  getSenderFor,
  invalidateSender,
} from "../services/connections.js";

const TlsMode = z.enum(["none", "starttls", "tls"]);
const AuthMethod = z.enum(["none", "login", "plain", "cram-md5"]);

const SmtpConfig = z
  .object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    tls_mode: TlsMode,
    tls_skip_verify: z.boolean().default(false),
    auth_method: AuthMethod,
    username: z.string().optional(),
    password: z.string().optional(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.auth_method !== "none" && (!cfg.username || !cfg.password)) {
      ctx.addIssue({
        code: "custom",
        message: "username and password are required unless auth_method is 'none'",
      });
    }
  });

const SesConfig = z.object({
  region: z.string().min(1),
  access_key_id: z.string().optional(),
  secret_access_key: z.string().optional(),
  use_iam_role: z.boolean().optional(),
});

const ConnectionTypeSchema = z.enum(["smtp", "ses"]);

const CreateConnection = z
  .object({
    name: z.string().min(1),
    type: ConnectionTypeSchema,
    from_email: z.string().email(),
    from_name: z.string().optional(),
    enabled: z.boolean().default(true),
    max_errors: z.number().int().positive().default(20),
    rate_limit_count: z.number().int().positive().nullish(),
    rate_limit_duration_seconds: z.number().int().positive().nullish(),
    config: z.unknown(),
  })
  .superRefine((body, ctx) => {
    const result =
      body.type === "ses" ? SesConfig.safeParse(body.config) : SmtpConfig.safeParse(body.config);
    if (!result.success) {
      for (const issue of result.error.issues) ctx.addIssue(issue);
    }
  });

const UpdateConnection = z.object({
  name: z.string().min(1).optional(),
  from_email: z.string().email().optional(),
  from_name: z.string().optional(),
  enabled: z.boolean().optional(),
  max_errors: z.number().int().positive().optional(),
  rate_limit_count: z.number().int().positive().nullish(),
  rate_limit_duration_seconds: z.number().int().positive().nullish(),
  config: z.unknown().optional(),
});

const TestConnection = z.object({
  type: ConnectionTypeSchema,
  config: z.unknown(),
  from_email: z.string().email().optional(),
  from_name: z.string().optional(),
});

type ConnectionRow = {
  id: number;
  name: string;
  type: ConnectionType;
  config: ConnectionConfig;
  from_email: string;
  from_name: string;
  rate_limit_count: number | null;
  rate_limit_duration_seconds: number | null;
  enabled: boolean;
  max_errors: number;
  error_count: number;
  disabled_reason: string | null;
  created_at: string;
  updated_at: string;
};

function mask<T extends ConnectionRow>(row: T): T {
  const config = { ...(row.config as unknown as Record<string, unknown>) };
  if (row.type === "ses") {
    if (config["secret_access_key"]) config["secret_access_key"] = "••••••••";
  } else {
    if (config["password"]) config["password"] = "••••••••";
  }
  return { ...row, config: config as unknown as ConnectionConfig };
}

/** Merge a partial config patch onto an existing row, preserving secret fields
 * the client didn't resend (the UI masks them, so an empty value means "keep"). */
function mergeConfig(existing: ConnectionRow, patch: unknown): ConnectionConfig {
  const next = { ...(patch as Record<string, unknown> | undefined) };
  if (existing.type === "ses") {
    const ex = existing.config as SesConnectionConfig;
    return {
      region: (next["region"] as string) ?? ex.region,
      access_key_id: (next["access_key_id"] as string | undefined) ?? ex.access_key_id,
      secret_access_key: (next["secret_access_key"] as string | undefined) ?? ex.secret_access_key,
      use_iam_role: (next["use_iam_role"] as boolean | undefined) ?? ex.use_iam_role,
    };
  }
  const ex = existing.config as SmtpConnectionConfig;
  return {
    host: (next["host"] as string) ?? ex.host,
    port: (next["port"] as number) ?? ex.port,
    tls_mode: (next["tls_mode"] as SmtpConnectionConfig["tls_mode"]) ?? ex.tls_mode,
    tls_skip_verify: (next["tls_skip_verify"] as boolean | undefined) ?? ex.tls_skip_verify,
    auth_method: (next["auth_method"] as SmtpConnectionConfig["auth_method"]) ?? ex.auth_method,
    username: (next["username"] as string | undefined) ?? ex.username,
    password: (next["password"] as string | undefined) ?? ex.password,
  };
}

export default async function connectionRoutes(app: FastifyInstance, opts: { db: DB }) {
  const { db } = opts;
  app.addHook("preHandler", app.requireAuth);

  app.get("/api/v1/connections", async () => {
    const rows = await db.selectFrom("connections").selectAll().orderBy("id", "desc").execute();
    return (rows as unknown as ConnectionRow[]).map(mask);
  });

  app.get("/api/v1/connections/:id", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    const row = await db
      .selectFrom("connections")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!row) throw new NotFoundError("connection");
    return mask(row as unknown as ConnectionRow);
  });

  app.post("/api/v1/connections", async (req, reply) => {
    const body = CreateConnection.parse(req.body);
    const config =
      body.type === "ses" ? SesConfig.parse(body.config) : SmtpConfig.parse(body.config);

    const row = await db
      .insertInto("connections")
      .values({
        name: body.name,
        type: body.type,
        from_email: body.from_email,
        from_name: body.from_name ?? "",
        config,
        enabled: body.enabled,
        max_errors: body.max_errors,
        rate_limit_count: body.rate_limit_count ?? null,
        rate_limit_duration_seconds: body.rate_limit_duration_seconds ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    reply.code(201);
    return mask(row as unknown as ConnectionRow);
  });

  app.patch("/api/v1/connections/:id", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    const body = UpdateConnection.parse(req.body);

    const existing = await db
      .selectFrom("connections")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!existing) throw new NotFoundError("connection");

    const set: Record<string, unknown> = {};
    if (body.name !== undefined) set.name = body.name;
    if (body.from_email !== undefined) set.from_email = body.from_email;
    if (body.from_name !== undefined) set.from_name = body.from_name;
    if (body.enabled !== undefined) set.enabled = body.enabled;
    if (body.max_errors !== undefined) set.max_errors = body.max_errors;
    if (body.rate_limit_count !== undefined) set.rate_limit_count = body.rate_limit_count;
    if (body.rate_limit_duration_seconds !== undefined)
      set.rate_limit_duration_seconds = body.rate_limit_duration_seconds;

    if (body.config !== undefined) {
      const merged = mergeConfig(existing as unknown as ConnectionRow, body.config);
      // Validate the merged config against the row's type.
      const parsed = existing.type === "ses" ? SesConfig.parse(merged) : SmtpConfig.parse(merged);
      set.config = parsed;
    }

    const row = await db
      .updateTable("connections")
      .set(set)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    invalidateSender(id);
    return mask(row as unknown as ConnectionRow);
  });

  app.delete("/api/v1/connections/:id", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    await db.deleteFrom("connections").where("id", "=", id).execute();
    invalidateSender(id);
    return { ok: true };
  });

  app.post("/api/v1/connections/:id/enable", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    await db
      .updateTable("connections")
      .set({ enabled: true, error_count: 0, disabled_reason: null })
      .where("id", "=", id)
      .execute();
    return { ok: true };
  });

  // Test a saved connection's credentials/reachability.
  app.post("/api/v1/connections/:id/test", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    const row = await db
      .selectFrom("connections")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!row) throw new NotFoundError("connection");
    try {
      const sender = getSenderFor(row as unknown as Connection);
      await sender.verify();
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Test an unsaved config (works for a draft before it's ever persisted).
  app.post("/api/v1/connections/test", async (req) => {
    const body = TestConnection.parse(req.body);
    const config =
      body.type === "ses" ? SesConfig.parse(body.config) : SmtpConfig.parse(body.config);
    try {
      const sender = createSender(body.type, config);
      await sender.verify();
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
