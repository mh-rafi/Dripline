import { randomUUID } from "node:crypto";
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
  /** The text/plain alternative part. Always set for campaign and automation
   * mail -- an HTML-only message is a standing SpamAssassin penalty
   * (MIME_HTML_ONLY). See docs/plan/deliverability.md. */
  text?: string;
  /** Overrides the connection's from_email (e.g. a campaign-level From). */
  fromOverride?: string | null;
  /** Overrides the display name shown beside the From address. Valid on its
   * own -- without fromOverride the connection's address is still used. */
  fromNameOverride?: string | null;
  /** Overrides the connection's own reply_to for this send. */
  replyTo?: string | null;
  /** The signed unsubscribe link for this recipient+campaign, if applicable.
   * Used to build the List-Unsubscribe header (see `connection.list_unsubscribe_header`) --
   * not otherwise sent as-is, since it's also embedded in the rendered body. */
  unsubscribeUrl?: string;
}

export interface SendResult {
  ok: boolean;
  connectionId: number | null;
  error: string | null;
  /** The Message-ID actually used for this send (SMTP: nodemailer's
   * generated/echoed value; SES: the bare id SES returns, not RFC 2822
   * angle-bracket form). Null on a failed send. Stored on campaign_emails
   * so a later bounce-mailbox scan can match a DSN back to this exact send --
   * see docs/plan/mailbox_bounce_scanning.md. */
  messageId: string | null;
}

export interface SendMailInput {
  to: string;
  from: string;
  subject: string;
  html: string;
  /** Paired with `html` this produces multipart/alternative. On its own
   * (empty `html`) it produces a genuine text/plain message, which is what a
   * plain-text campaign sends. */
  text?: string;
  replyTo?: string;
  /** RFC 2822 Message-ID, angle brackets included. SMTP only -- SES replaces
   * whatever it is given, so SesSender ignores it. */
  messageId?: string;
  headers?: Record<string, string>;
  /** SMTP envelope MAIL FROM override, independent of the visible `from`
   * header -- only meaningful for SmtpSender; SES has no equivalent here
   * (its own bounce/complaint reporting goes through the webhook/SNS path
   * instead). Set when this connection's bounce_config points at a separate
   * mailbox, so DSNs actually route there instead of back to `from`. See
   * docs/plan/mailbox_bounce_scanning.md §2.3. */
  envelopeFrom?: string;
}

/** A normalized sending interface so additional provider types (Postmark,
 * SendGrid, Mailgun, ...) are new implementations, not a redesign. */
export interface ConnectionSender {
  send(input: SendMailInput): Promise<{ messageId: string | null }>;
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
  async send(input: SendMailInput) {
    const info = await this.transporter.sendMail({
      from: input.from,
      to: input.to,
      subject: input.subject,
      ...(input.html ? { html: input.html } : {}),
      ...(input.text ? { text: input.text } : {}),
      replyTo: input.replyTo,
      messageId: input.messageId,
      headers: input.headers,
      ...(input.envelopeFrom ? { envelope: { from: input.envelopeFrom, to: input.to } } : {}),
    });
    return { messageId: info.messageId ?? null };
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

  async send(input: SendMailInput) {
    const client = await this.client();
    const { SendEmailCommand } = await import("@aws-sdk/client-sesv2");
    const headers = input.headers
      ? Object.entries(input.headers).map(([Name, Value]) => ({ Name, Value }))
      : undefined;
    const cmd = new SendEmailCommand({
      FromEmailAddress: input.from,
      Destination: { ToAddresses: [input.to] },
      ReplyToAddresses: input.replyTo ? [input.replyTo] : undefined,
      Content: {
        Simple: {
          Subject: { Data: input.subject },
          Body: {
            ...(input.html ? { Html: { Data: input.html } } : {}),
            ...(input.text ? { Text: { Data: input.text } } : {}),
          },
          Headers: headers,
        },
      },
    });
    // SES's own MessageId is a bare id (not RFC 2822 angle-bracket form) --
    // a bounce DSN's echoed Message-ID may not match it byte-for-byte
    // depending on how the receiving MTA formats it. SES bounces are
    // expected to be reported via the existing webhook/SNS path anyway
    // (see docs/plan/mailbox_bounce_scanning.md), not mailbox scanning, so
    // this is best-effort for SES specifically.
    const result = (await client.send(cmd as never)) as { MessageId?: string };
    return { messageId: result.MessageId ?? null };
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

// RFC 5322 allows an unquoted display name only when it is made of atoms; a
// comma, dot, angle bracket or quote in it has to be quoted or the header
// parses as several addresses ("Doe, Jane <a@b.c>" becomes two recipients).
const ATOM_SAFE_NAME = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~ -]+$/;

function formatAddress(email: string, name?: string | null): string {
  const display = name?.trim();
  if (!display) return email;
  const quoted = ATOM_SAFE_NAME.test(display)
    ? display
    : `"${display.replace(/([\\"])/g, "\\$1")}"`;
  return `${quoted} <${email}>`;
}

function fromAddress(
  connection: Connection,
  override?: string | null,
  nameOverride?: string | null,
): string {
  const email = override || connection.from_email;
  // An explicit campaign From address may belong to a different identity than
  // the connection, so the connection's display name is not carried over to it
  // -- but a campaign-level name is, and applies on its own to the connection's
  // own address.
  const name = nameOverride?.trim() ? nameOverride : override ? null : connection.from_name;
  return formatAddress(email, name);
}

/** Only the URL form of List-Unsubscribe -- no `mailto:` option, since that
 * would need a mailbox that actually receives and processes unsubscribe
 * requests (IMAP polling or similar), which this project doesn't have. The
 * URL form plus one-click POST is what modern mailbox providers' 2024 bulk
 * sender requirements actually ask for. */
function listUnsubscribeHeaders(
  connection: Connection,
  unsubscribeUrl: string | undefined,
): Record<string, string> | undefined {
  if (!connection.list_unsubscribe_header || !unsubscribeUrl) return undefined;
  return {
    "List-Unsubscribe": `<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/** Chosen here rather than left to nodemailer so the id's domain is always
 * the sending identity's, and so campaign_emails.message_id holds a value we
 * picked instead of one the transport happened to echo back -- which is what
 * bounceScanner matches DSNs against. SES ignores it and mints its own. */
function generateMessageId(from: string): string {
  // `from` is a formatted address ("Name" <a@b>), and the display name can
  // itself contain an @ -- take what's inside the angle brackets first.
  const address = from.match(/<([^>]+)>/)?.[1] ?? from;
  const domain = address.split("@")[1]?.trim() || "localhost";
  return `<${randomUUID()}@${domain}>`;
}

/** SMTP envelope-from override for connections with a separate bounce
 * mailbox -- see docs/plan/mailbox_bounce_scanning.md §2.3. Only meaningful
 * when bounce scanning is enabled AND pointed at a mailbox other than this
 * connection's own (use_sending_credentials: false). Uses `bounce_config.
 email` -- a distinct field from `username` -- because an IMAP login isn't
 * always a real email address (e.g. shared/cPanel Dovecot setups and older
 * on-prem Exchange commonly authenticate with a bare local-part or SAM
 * account name, not the full address); using `username` directly here would
 * produce an invalid MAIL FROM on any provider where that's the case.
 * Undefined (no override) leaves envelope-from at its default -- the
 * visible `from` address -- which is correct both when bounce scanning is
 * off and when it reuses the sending mailbox (a "use_sending_credentials"
 * setup needs no redirection, that mailbox already receives its own
 * bounces with no configuration). */
function bounceEnvelopeFrom(connection: Connection): string | undefined {
  const cfg = connection.bounce_config;
  if (!cfg?.enabled || cfg.use_sending_credentials) return undefined;
  return cfg.email || undefined;
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
    return { ok: false, connectionId: connection.id, error: "rate_limited", messageId: null };
  }

  const sender = getSenderFor(connection);
  const from = fromAddress(connection, input.fromOverride, input.fromNameOverride);
  try {
    const { messageId } = await sender.send({
      to: input.to,
      from,
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo ?? connection.reply_to ?? undefined,
      messageId: generateMessageId(from),
      headers: listUnsubscribeHeaders(connection, input.unsubscribeUrl),
      envelopeFrom: bounceEnvelopeFrom(connection),
    });
    await recordConnectionResult(db, connection.id, true);
    return { ok: true, connectionId: connection.id, error: null, messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordConnectionResult(db, connection.id, false);
    return { ok: false, connectionId: connection.id, error: message, messageId: null };
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
    return {
      ok: false,
      connectionId: null,
      error: "no sending connection configured",
      messageId: null,
    };
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
  return {
    ok: false,
    connectionId: null,
    error: onlyRateLimited ? "rate_limited" : lastError,
    messageId: null,
  };
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

/** Connections for a send that names them explicitly (an automation's
 * send-email node): the primary `connection_id` plus any ordered
 * `fallback_connection_ids`. Deliberately has no implicit fallback to "any
 * enabled connection" -- picking one on the author's behalf is exactly the
 * cross-domain-mixing risk this whole connection model exists to prevent
 * (see docs/prd/PRD.md §6.3). A node that names no connection sends nothing
 * until it does. */
export async function getExplicitConnectionChain(
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
