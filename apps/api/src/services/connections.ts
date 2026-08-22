import nodemailer, { type Transporter } from "nodemailer";
import type { Selectable } from "kysely";
import type { DB } from "../db/kysely.js";
import type {
  ConnectionConfig,
  ConnectionType,
  ConnectionsTable,
  SesConnectionConfig,
  SmtpConnectionConfig,
} from "../db/types.js";
import { tryAcquireSendSlot } from "./rateLimiter.js";

type Connection = Selectable<ConnectionsTable>;

export type { Connection };

export interface SendInput {
  to: string;
  subject: string;
  html: string;
  /** Overrides the connection's from_email (e.g. a campaign-level From). */
  fromOverride?: string | null;
}

export interface SendResult {
  ok: boolean;
  connectionId: number | null;
  error: string | null;
}

/** A normalized sending interface so additional provider types (Postmark,
 * SendGrid, Mailgun, ...) are new implementations, not a redesign. */
export interface ConnectionSender {
  send(input: { to: string; from: string; subject: string; html: string }): Promise<void>;
  /** Lightweight credentials/reachability check used by the test-connection UI. */
  verify(): Promise<void>;
}

// ---- SMTP -------------------------------------------------------------------

function buildSmtpTransporter(cfg: SmtpConnectionConfig): Transporter {
  const auth =
    cfg.auth_method === "none" || (!cfg.username && !cfg.password)
      ? undefined
      : { user: cfg.username ?? "", pass: cfg.password ?? "" };

  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.tls_mode === "tls",
    requireTLS: cfg.tls_mode === "starttls",
    tls: { rejectUnauthorized: !cfg.tls_skip_verify },
    auth,
  });
}

class SmtpSender implements ConnectionSender {
  constructor(private transporter: Transporter) {}
  async send(input: { to: string; from: string; subject: string; html: string }) {
    await this.transporter.sendMail({
      from: input.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
    });
  }
  async verify() {
    await this.transporter.verify();
  }
}

// ---- AWS SES ----------------------------------------------------------------

class SesSender implements ConnectionSender {
  private clientPromise: Promise<SESv2ClientLike> | null = null;

  constructor(private cfg: SesConnectionConfig) {}

  private client(): Promise<SESv2ClientLike> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const { SESv2Client } = await import("@aws-sdk/client-sesv2");
        const useIam =
          this.cfg.use_iam_role || (!this.cfg.access_key_id && !this.cfg.secret_access_key);
        const credentials =
          useIam || !this.cfg.access_key_id || !this.cfg.secret_access_key
            ? undefined
            : {
                accessKeyId: this.cfg.access_key_id,
                secretAccessKey: this.cfg.secret_access_key,
              };
        return new SESv2Client({
          region: this.cfg.region,
          credentials,
        }) as unknown as SESv2ClientLike;
      })();
    }
    return this.clientPromise;
  }

  async send(input: { to: string; from: string; subject: string; html: string }) {
    const client = await this.client();
    const { SendEmailCommand } = await import("@aws-sdk/client-sesv2");
    const cmd = new SendEmailCommand({
      FromEmailAddress: input.from,
      Destination: { ToAddresses: [input.to] },
      Content: {
        Simple: {
          Subject: { Data: input.subject },
          Body: { Html: { Data: input.html } },
        },
      },
    });
    await client.send(cmd as never);
  }

  async verify() {
    const client = await this.client();
    const { GetAccountCommand } = await import("@aws-sdk/client-sesv2");
    // GetAccount is the standard pre-flight check for SES -- it's covered by
    // even a minimal send-only IAM policy, unlike list/read calls on other
    // resource types (templates, contact lists, ...) that a scoped-down
    // sending credential often isn't granted.
    await client.send(new GetAccountCommand({}) as never);
  }
}

// Minimal structural type for the SES client so the rest of the module doesn't
// import the SDK at module load (it's loaded lazily only when SES is used).
interface SESv2ClientLike {
  send<T>(command: unknown): Promise<T>;
}

// ---- factory + cache --------------------------------------------------------

const senderCache = new Map<number, ConnectionSender>();

export function createSender(type: ConnectionType, config: ConnectionConfig): ConnectionSender {
  if (type === "ses") {
    return new SesSender(config as SesConnectionConfig);
  }
  return new SmtpSender(buildSmtpTransporter(config as SmtpConnectionConfig));
}

export function getSenderFor(connection: Connection): ConnectionSender {
  const cached = senderCache.get(connection.id);
  if (cached) return cached;
  const sender = createSender(connection.type, connection.config);
  senderCache.set(connection.id, sender);
  return sender;
}

/** Drop a connection's cached sender, e.g. after its config was edited. */
export function invalidateSender(connectionId: number): void {
  senderCache.delete(connectionId);
}

function fromAddress(connection: Connection, override?: string | null): string {
  // An explicit campaign From overrides the address verbatim (no display name),
  // since it may belong to a different identity than the connection. Otherwise the
  // connection's own from_email/from_name is the authorized sending identity.
  if (override) return override;
  if (connection.from_name) return `${connection.from_name} <${connection.from_email}>`;
  return connection.from_email;
}

// ---- result recording + auto-disable ---------------------------------------

async function recordConnectionResult(
  db: DB,
  connectionId: number,
  success: boolean,
): Promise<void> {
  if (success) {
    await db
      .updateTable("connections")
      .set({ error_count: 0 })
      .where("id", "=", connectionId)
      .execute();
    return;
  }

  const conn = await db
    .selectFrom("connections")
    .select(["error_count", "max_errors"])
    .where("id", "=", connectionId)
    .executeTakeFirst();
  if (!conn) return;

  const errorCount = conn.error_count + 1;
  const shouldDisable = errorCount >= conn.max_errors;

  await db
    .updateTable("connections")
    .set({
      error_count: errorCount,
      ...(shouldDisable
        ? {
            enabled: false,
            disabled_reason: `auto-disabled after ${errorCount} consecutive errors`,
          }
        : {}),
    })
    .where("id", "=", connectionId)
    .execute();
}

// ---- sending ----------------------------------------------------------------

/** Sends through a single connection, honoring its per-connection rate limit.
 * A rate-limited result is *not* a failure: the caller should skip to a fallback
 * or leave the recipient pending for the next tick. */
export async function sendThroughConnection(
  db: DB,
  connection: Connection,
  input: SendInput,
): Promise<SendResult> {
  const acquired = await tryAcquireSendSlot(db, connection.id);
  if (!acquired) {
    return { ok: false, connectionId: connection.id, error: "rate_limited" };
  }

  const sender = getSenderFor(connection);
  try {
    await sender.send({
      to: input.to,
      from: fromAddress(connection, input.fromOverride),
      subject: input.subject,
      html: input.html,
    });
    await recordConnectionResult(db, connection.id, true);
    return { ok: true, connectionId: connection.id, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordConnectionResult(db, connection.id, false);
    return { ok: false, connectionId: connection.id, error: message };
  }
}

/** Sends through an ordered connection chain: the primary first, then explicit
 * fallbacks in priority order. A disabled or rate-limited connection is skipped
 * in favor of the next one *in the campaign's own chain* -- never a connection
 * the campaign didn't list. On a real send error it also fails over to the next. */
export async function sendWithChain(
  db: DB,
  connections: Connection[],
  input: SendInput,
): Promise<SendResult> {
  if (connections.length === 0) {
    return { ok: false, connectionId: null, error: "no sending connection configured" };
  }

  let lastError = "all connections failed";
  // Tracks whether *every* attempt so far was only rate-limited (as opposed
  // to a real send error). If the whole chain is exhausted and this is still
  // true, the caller should treat it as "try again later," not a delivery
  // failure -- a real error anywhere in the chain takes precedence, since a
  // permanently-broken fallback shouldn't be masked by an earlier rate limit.
  let onlyRateLimited = true;
  for (const connection of connections) {
    if (!connection.enabled) {
      lastError = "primary connection disabled";
      onlyRateLimited = false;
      continue;
    }
    const result = await sendThroughConnection(db, connection, input);
    if (result.ok) return result;
    if (result.error === "rate_limited") {
      continue; // not a failure -- try the next fallback.
    }
    lastError = result.error ?? lastError;
    onlyRateLimited = false;
    continue; // real error -- fail over to the next in the chain.
  }
  return { ok: false, connectionId: null, error: onlyRateLimited ? "rate_limited" : lastError };
}

// ---- chain resolution --------------------------------------------------------

/** The ordered (primary -> fallbacks) connections a campaign sends through. */
export async function getConnectionChain(db: DB, campaignId: number): Promise<Connection[]> {
  const rows = await db
    .selectFrom("campaign_connections")
    .innerJoin("connections", "connections.id", "campaign_connections.connection_id")
    .selectAll("connections")
    .where("campaign_connections.campaign_id", "=", campaignId)
    .orderBy("campaign_connections.priority", "asc")
    .orderBy("connections.id", "asc")
    .execute();
  return rows as unknown as Connection[];
}

/** Connections for a workflow's send_email step: the primary `connection_id`
 * plus any explicit ordered `fallback_connection_ids`. Deliberately has no
 * implicit fallback to "any enabled connection" -- picking one on the
 * workflow author's behalf is exactly the cross-domain-mixing risk this
 * whole connection model exists to prevent (see docs/prd/PRD.md §6.3). If a
 * send_email step doesn't name a connection, it sends nothing until it does. */
export async function getWorkflowConnectionChain(
  db: DB,
  connectionId: number | undefined,
  fallbackIds: number[] | undefined,
): Promise<Connection[]> {
  const ids = [connectionId, ...(fallbackIds ?? [])].filter((x): x is number => x != null);
  if (ids.length === 0) return [];

  const rows = await db.selectFrom("connections").selectAll().where("id", "in", ids).execute();
  // Preserve the caller's ordering (primary first).
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is Connection => r != null);
}
