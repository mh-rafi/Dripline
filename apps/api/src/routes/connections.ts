import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import type {
  BounceMailboxConfig,
  ConnectionConfig,
  ConnectionType,
  SesConnectionConfig,
  SmtpConnectionConfig,
} from "../db/types.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import {
  createSender,
  type Connection,
  getSenderFor,
  invalidateSender,
} from "../services/connections.js";
import { resolveBounceMailbox, testBounceMailbox } from "../services/bounceScanner.js";

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

// See docs/plan/mailbox_bounce_scanning.md. host/port/username/password are
// only required when enabled and not reusing the connection's own sending
// credentials -- enforced below, alongside the ses/use_sending_credentials
// constraint, once the connection `type` is known.
const BounceConfig = z.object({
  enabled: z.boolean().default(false),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  tls: z.boolean().default(true),
  username: z.string().optional(),
  password: z.string().optional(),
  // The address bounces should be sent to -- distinct from `username`,
  // which is an IMAP login and not always a real email address (e.g.
  // shared/cPanel Dovecot setups and older on-prem Exchange commonly
  // authenticate with a bare local-part or SAM account name, not the full
  // address). Only required/meaningful when use_sending_credentials is
  // false; see bounceEnvelopeFrom in services/connections.ts.
  email: z.string().email().optional(),
  use_sending_credentials: z.boolean().default(true),
  folder: z.string().min(1).default("INBOX"),
  max_age_days: z.number().int().positive().default(7),
  max_messages_per_scan: z.number().int().positive().default(200),
});

function validateBounceConfig(
  type: "smtp" | "ses",
  bounceConfig: z.infer<typeof BounceConfig> | undefined,
  ctx: z.RefinementCtx,
) {
  if (!bounceConfig?.enabled) return;
  // IMAP host/port are always required, even when reusing the sending
  // mailbox's username/password -- a provider's SMTP submission host and
  // IMAP host are almost never the same hostname (e.g.
  // smtp.yourmailserver.com vs imap.yourmailserver.com), so "use sending
  // credentials" can only mean reusing the login, never the host/port.
  for (const field of ["host", "port"] as const) {
    if (!bounceConfig[field]) {
      ctx.addIssue({
        code: "custom",
        path: ["bounce_config", field],
        message: `${field} is required`,
      });
    }
  }
  if (type === "ses" && bounceConfig.use_sending_credentials) {
    ctx.addIssue({
      code: "custom",
      path: ["bounce_config", "use_sending_credentials"],
      message: "SES connections have no sending mailbox login to reuse -- provide IMAP credentials",
    });
  }
  if (!bounceConfig.use_sending_credentials) {
    for (const field of ["username", "password", "email"] as const) {
      if (!bounceConfig[field]) {
        ctx.addIssue({
          code: "custom",
          path: ["bounce_config", field],
          message: `${field} is required unless reusing the sending mailbox's login`,
        });
      }
    }
  }
}

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
    list_unsubscribe_header: z.boolean().default(true),
    config: z.unknown(),
    bounce_config: BounceConfig.optional(),
  })
  .superRefine((body, ctx) => {
    const result =
      body.type === "ses" ? SesConfig.safeParse(body.config) : SmtpConfig.safeParse(body.config);
    if (!result.success) {
      // zod 4's issue objects aren't accepted verbatim by addIssue -- re-raise
      // each one as a custom issue so the connection-config errors still come
      // back attached to the right field path.
      for (const issue of result.error.issues) {
        ctx.addIssue({
          code: "custom",
          path: ["config", ...issue.path],
          message: issue.message,
        });
      }
    }
    validateBounceConfig(body.type, body.bounce_config, ctx);
  });

const UpdateConnection = z.object({
  name: z.string().min(1).optional(),
  from_email: z.string().email().optional(),
  from_name: z.string().optional(),
  enabled: z.boolean().optional(),
  max_errors: z.number().int().positive().optional(),
  rate_limit_count: z.number().int().positive().nullish(),
  rate_limit_duration_seconds: z.number().int().positive().nullish(),
  list_unsubscribe_header: z.boolean().optional(),
  config: z.unknown().optional(),
  bounce_config: BounceConfig.optional(),
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
  list_unsubscribe_header: boolean;
  bounce_config: BounceMailboxConfig | null;
  bounce_last_uid: number | null;
  bounce_last_uidvalidity: string | null;
  bounce_error_count: number;
  bounce_disabled_reason: string | null;
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
  const bounceConfig = row.bounce_config
    ? { ...row.bounce_config, password: row.bounce_config.password ? "••••••••" : "" }
    : null;
  return { ...row, config: config as unknown as ConnectionConfig, bounce_config: bounceConfig };
}

/** Same "empty value means keep the existing secret" rule as mergeConfig
 * below, applied to bounce_config.password. */
function mergeBounceConfig(
  existing: BounceMailboxConfig | null,
  patch: z.infer<typeof BounceConfig> | undefined,
): BounceMailboxConfig | null {
  if (!patch) return existing ?? null;
  return {
    enabled: patch.enabled,
    host: patch.host ?? existing?.host ?? "",
    port: patch.port ?? existing?.port ?? 993,
    tls: patch.tls,
    username: patch.username ?? existing?.username ?? "",
    password: patch.password || existing?.password || "",
    email: patch.email ?? existing?.email ?? "",
    use_sending_credentials: patch.use_sending_credentials,
    folder: patch.folder,
    max_age_days: patch.max_age_days,
    max_messages_per_scan: patch.max_messages_per_scan,
  };
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
        list_unsubscribe_header: body.list_unsubscribe_header,
        bounce_config: mergeBounceConfig(null, body.bounce_config),
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
    if (body.list_unsubscribe_header !== undefined)
      set.list_unsubscribe_header = body.list_unsubscribe_header;

    if (body.config !== undefined) {
      const merged = mergeConfig(existing as unknown as ConnectionRow, body.config);
      // Validate the merged config against the row's type.
      const parsed = existing.type === "ses" ? SesConfig.parse(merged) : SmtpConfig.parse(merged);
      set.config = parsed;
    }

    if (body.bounce_config !== undefined) {
      const merged = mergeBounceConfig(
        existing.bounce_config as BounceMailboxConfig | null,
        body.bounce_config,
      );
      if (merged?.enabled) {
        // See validateBounceConfig's comment: host/port are always required
        // (IMAP host differs from the SMTP submission host even when the
        // mailbox is the same one), username/password only when not reusing
        // the sending login.
        for (const field of ["host", "port"] as const) {
          if (!merged[field]) throw new BadRequestError(`bounce_config.${field} is required`);
        }
        if (existing.type === "ses" && merged.use_sending_credentials) {
          throw new BadRequestError(
            "SES connections have no sending mailbox login to reuse -- provide IMAP credentials",
          );
        }
        if (!merged.use_sending_credentials) {
          for (const field of ["username", "password", "email"] as const) {
            if (!merged[field]) {
              throw new BadRequestError(
                `bounce_config.${field} is required unless reusing the sending mailbox's login`,
              );
            }
          }
        }
      }
      set.bounce_config = merged;
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

  // Test a saved connection's bounce mailbox. Connects and opens the
  // configured folder only -- never fetches or touches any mail, matching
  // the scanner's own read-only guarantee (see
  // docs/plan/mailbox_bounce_scanning.md §5/§6 -- this cannot verify that a
  // *separate* mailbox actually receives bounces, only that it's reachable).
  app.post("/api/v1/connections/:id/bounce-test", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    const row = await db
      .selectFrom("connections")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!row) throw new NotFoundError("connection");
    const mailbox = resolveBounceMailbox(row as unknown as Connection);
    if (!mailbox) return { ok: false, error: "bounce mailbox scanning is not configured" };
    try {
      await testBounceMailbox(mailbox);
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Test an unsaved bounce mailbox config (a draft before the connection is
  // saved, or edits to an already-saved one not yet submitted).
  app.post("/api/v1/connections/bounce-test", async (req) => {
    const body = z
      .object({ type: ConnectionTypeSchema, config: z.unknown(), bounce_config: BounceConfig })
      .parse(req.body);
    const config =
      body.type === "ses" ? SesConfig.parse(body.config) : SmtpConfig.parse(body.config);
    const draft = {
      type: body.type,
      config,
      bounce_config: mergeBounceConfig(null, body.bounce_config),
    } as unknown as Connection;
    const mailbox = resolveBounceMailbox(draft);
    if (!mailbox) return { ok: false, error: "bounce mailbox scanning is not enabled" };
    try {
      await testBounceMailbox(mailbox);
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
