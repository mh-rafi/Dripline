import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { Selectable } from "kysely";
import type { DB } from "../db/kysely.js";
import type { BounceType, ConnectionsTable, SmtpConnectionConfig } from "../db/types.js";
import { recordBounce } from "./bounces.js";

type Connection = Selectable<ConnectionsTable>;

// A backlog larger than this on a first-ever (or post-UIDVALIDITY-reset)
// scan is worked off across several ticks, not fetched in one shot -- see
// docs/plan/mailbox_bounce_scanning.md §5.
const FETCH_CHUNK_SIZE = 20;
// A broken mailbox login/connection auto-disables scanning for that
// connection after this many consecutive failures, mirroring the existing
// error_count/auto-disable pattern for sending (services/connections.ts),
// but scoped to bounce scanning only -- it must never affect sending.
const MAX_CONSECUTIVE_ERRORS = 5;

export interface ResolvedBounceMailbox {
  host: string;
  port: number;
  tls: boolean;
  username: string;
  password: string;
  folder: string;
  maxAgeDays: number;
  maxMessagesPerScan: number;
}

/**
 * Resolves the effective IMAP login for a connection's bounce mailbox.
 * host/port/tls always come from bounce_config itself -- a provider's SMTP
 * submission host and IMAP host are almost never the same hostname even for
 * the same mailbox (e.g. smtp.yourmailserver.com vs imap.yourmailserver.com),
 * so "use sending credentials" can only mean reusing the login, never
 * host/port (see routes/connections.ts's validateBounceConfig).
 * Returns null when bounce scanning isn't configured/enabled at all.
 */
export function resolveBounceMailbox(connection: Connection): ResolvedBounceMailbox | null {
  const cfg = connection.bounce_config;
  if (!cfg?.enabled) return null;

  let username = cfg.username;
  let password = cfg.password;
  if (cfg.use_sending_credentials && connection.type === "smtp") {
    const smtp = connection.config as SmtpConnectionConfig;
    username = smtp.username ?? "";
    password = smtp.password ?? "";
  }

  return {
    host: cfg.host,
    port: cfg.port,
    tls: cfg.tls,
    username,
    password,
    folder: cfg.folder || "INBOX",
    maxAgeDays: cfg.max_age_days || 7,
    maxMessagesPerScan: cfg.max_messages_per_scan || 200,
  };
}

function openClient(mailbox: ResolvedBounceMailbox): ImapFlow {
  return new ImapFlow({
    host: mailbox.host,
    port: mailbox.port,
    secure: mailbox.tls,
    auth: { user: mailbox.username, pass: mailbox.password },
    logger: false,
  });
}

/** Lightweight reachability/auth check for the "Test connection" UI --
 * connects, opens the configured folder, disconnects. Never fetches,
 * flags, or otherwise touches any mail (matches the scanner's own read-only
 * guarantee -- see docs/plan/mailbox_bounce_scanning.md §5 step 5). */
export async function testBounceMailbox(mailbox: ResolvedBounceMailbox): Promise<void> {
  const client = openClient(mailbox);
  await client.connect();
  try {
    const lock = await client.getMailboxLock(mailbox.folder);
    lock.release();
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

// ---- report parsing ----------------------------------------------------------

interface ParsedReport {
  type: BounceType;
  recipientEmail: string | null;
  messageId: string | null;
}

function headerValue(headers: Map<string, unknown>, name: string): string {
  const raw = headers.get(name);
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw !== null && "value" in raw) {
    return String((raw as { value: unknown }).value ?? "");
  }
  return String(raw);
}

/**
 * Feedback-Type values (RFC 5965 §7.3) that mean "this person reported us".
 * `not-spam` is deliberately excluded -- it is a *positive* signal some
 * providers send, and treating it as a complaint would blocklist someone for
 * rescuing our mail from their junk folder. `opt-out` and `virus` are
 * likewise ignored: neither is an abuse report, and an unsubscribe request
 * has its own List-Unsubscribe path.
 */
const COMPLAINT_FEEDBACK_TYPES = /^(abuse|fraud)$/i;

/** Pulls the original message's Message-ID out of an ARF report. The report
 * carries the reported mail's headers as a `message/rfc822` or
 * `text/rfc822-headers` part; the raw-source fallback skips the report's own
 * Message-ID, which sits in the outer envelope headers. */
async function originalMessageId(
  parsed: Awaited<ReturnType<typeof simpleParser>>,
  raw: Buffer,
): Promise<string | null> {
  const rfc822Part = parsed.attachments.find((a) => /message\/rfc822/i.test(a.contentType));
  if (rfc822Part) {
    const inner = await simpleParser(rfc822Part.content);
    if (inner.messageId) return inner.messageId;
  }

  const headersPart = parsed.attachments.find((a) => /rfc822-headers/i.test(a.contentType));
  if (headersPart) {
    const match = headersPart.content.toString("utf8").match(/^Message-ID:\s*(<[^>]+>)/im);
    if (match?.[1]) return match[1];
  }

  const outer = parsed.messageId;
  for (const match of raw.toString("utf8").matchAll(/^Message-ID:\s*(<[^>]+>)/gim)) {
    if (match[1] && match[1] !== outer) return match[1];
  }
  return null;
}

/**
 * Parses an ARF feedback report (RFC 5965) -- what a mailbox provider's
 * feedback loop sends when a recipient hits "mark as spam". Returns null if
 * this isn't an ARF report, or is one we don't act on.
 *
 * Checked *before* the DSN branch because an ARF report is also a
 * `multipart/report`: fall through to parseDsn and a complaint gets silently
 * recorded as a soft bounce instead.
 */
async function parseArf(
  parsed: Awaited<ReturnType<typeof simpleParser>>,
  contentType: string,
  raw: Buffer,
): Promise<ParsedReport | null> {
  const reportPart = parsed.attachments.find((a) =>
    /message\/feedback-report/i.test(a.contentType),
  );
  if (!/report-type=["']?feedback-report/i.test(contentType) && !reportPart) return null;

  // The machine-readable part is a small "Field: value" block, same shape as
  // a DSN's delivery-status part.
  const reportText = reportPart ? reportPart.content.toString("utf8") : (parsed.text ?? "");
  const feedbackType = reportText.match(/^Feedback-Type:\s*(\S+)/im)?.[1] ?? "";
  if (!COMPLAINT_FEEDBACK_TYPES.test(feedbackType)) return null;

  const recipientMatch =
    reportText.match(/^Original-Rcpt-To:\s*(\S+)/im) ??
    reportText.match(/^Removal-Recipient:\s*(\S+)/im);

  return {
    type: "complaint",
    recipientEmail: recipientMatch?.[1]?.replace(/[<>]/g, "") ?? null,
    messageId: await originalMessageId(parsed, raw),
  };
}

/**
 * Parses a raw fetched message and extracts bounce/complaint info, or null if
 * it is neither a DSN (RFC 3464) nor an actionable ARF report (RFC 5965) --
 * the common case for everything else sitting in a shared/noisy mailbox,
 * discarded cheaply without being written anywhere. See
 * docs/plan/mailbox_bounce_scanning.md §2 for the two-tier correlation
 * strategy this feeds into (Message-ID match, then address fallback).
 */
export async function parseReport(raw: Buffer): Promise<ParsedReport | null> {
  const parsed = await simpleParser(raw);
  const contentType = headerValue(parsed.headers, "content-type");

  const arf = await parseArf(parsed, contentType, raw);
  if (arf) return arf;

  const looksLikeDsn =
    /multipart\/report/i.test(contentType) ||
    parsed.attachments.some((a) => /delivery-status/i.test(a.contentType));
  if (!looksLikeDsn) return null;

  // The original outgoing message, if the DSN embedded it (message/rfc822
  // sub-part) -- exact Message-ID match, the primary correlation path.
  const rfc822Part = parsed.attachments.find((a) => /message\/rfc822/i.test(a.contentType));
  let messageId: string | null = null;
  if (rfc822Part) {
    const inner = await simpleParser(rfc822Part.content);
    messageId = inner.messageId ?? null;
  }
  if (!messageId) {
    const originalIdMatch = raw.toString("utf8").match(/Original-Message-ID:\s*(<[^>]+>)/i);
    messageId = originalIdMatch?.[1] ?? null;
  }

  // The message/delivery-status part -- a small RFC 3464 "Field: value"
  // block, not full MIME, safe to line-parse with plain regex.
  const statusPart = parsed.attachments.find((a) => /delivery-status/i.test(a.contentType));
  const statusText = statusPart ? statusPart.content.toString("utf8") : (parsed.text ?? "");

  const statusMatch = statusText.match(/^Status:\s*([45])\.\d+\.\d+/im);
  const isHard = statusMatch
    ? statusMatch[1] === "5"
    : /does not exist|no such user|user unknown|mailbox not found/i.test(statusText);

  const recipientMatch = statusText.match(/^(?:Final|Original)-Recipient:\s*rfc822;\s*(\S+)/im);
  const recipientEmail = recipientMatch?.[1]?.replace(/[<>]/g, "") ?? null;

  if (!messageId && !recipientEmail) return null;
  return { type: isHard ? "hard" : "soft", recipientEmail, messageId };
}

/** Resolves a parsed bounce or complaint to a subscriber/campaign and records
 * it via the existing recordBounce() -- Message-ID match first (exact
 * subscriber + campaign), recipient-address fallback second (subscriber only,
 * campaign_id: null). No match at all: silently dropped, same as an
 * unrecognized message. A complaint blocklists on the first occurrence
 * (COMPLAINT_THRESHOLD in services/bounces.ts). */
async function resolveAndRecordReport(db: DB, parsed: ParsedReport): Promise<void> {
  if (parsed.messageId) {
    const row = await db
      .selectFrom("campaign_emails")
      .select(["subscriber_id", "campaign_id"])
      .where("message_id", "=", parsed.messageId)
      .executeTakeFirst();
    if (row) {
      await recordBounce(db, {
        subscriberId: row.subscriber_id,
        campaignId: row.campaign_id,
        type: parsed.type,
        source: "mailbox-scan",
      });
      return;
    }
  }

  if (parsed.recipientEmail) {
    const subscriber = await db
      .selectFrom("subscribers")
      .select("id")
      .where("email", "=", parsed.recipientEmail)
      .executeTakeFirst();
    if (subscriber) {
      await recordBounce(db, {
        subscriberId: subscriber.id,
        campaignId: null,
        type: parsed.type,
        source: "mailbox-scan",
      });
    }
  }
}

// ---- scan --------------------------------------------------------------------

async function recordScanError(db: DB, connectionId: number, err: unknown): Promise<void> {
  const conn = await db
    .selectFrom("connections")
    .select(["bounce_error_count", "bounce_config"])
    .where("id", "=", connectionId)
    .executeTakeFirst();
  if (!conn) return;
  const errorCount = conn.bounce_error_count + 1;
  const message = err instanceof Error ? err.message : String(err);
  const shouldDisable = errorCount >= MAX_CONSECUTIVE_ERRORS && conn.bounce_config;

  await db
    .updateTable("connections")
    .set({
      bounce_error_count: errorCount,
      bounce_disabled_reason: `${message} (${errorCount} consecutive failures)`,
      ...(shouldDisable ? { bounce_config: { ...conn.bounce_config!, enabled: false } } : {}),
    })
    .where("id", "=", connectionId)
    .execute();
}

/** Scans one connection's bounce mailbox for new messages since the last
 * run, classifies any that look like a DSN (RFC 3464) or an ARF feedback
 * report (RFC 5965), and records matches via recordBounce().
 * Never marks messages \Seen, moves, or deletes anything --
 * the persisted UID cursor (connections.bounce_last_uid/uidvalidity) is the
 * only processed/unprocessed state this feature owns. See
 * docs/plan/mailbox_bounce_scanning.md §5 for the full algorithm this
 * implements. */
export async function scanConnectionForBounces(db: DB, connectionId: number): Promise<void> {
  const connection = await db
    .selectFrom("connections")
    .selectAll()
    .where("id", "=", connectionId)
    .executeTakeFirst();
  if (!connection) return;

  const mailbox = resolveBounceMailbox(connection as unknown as Connection);
  if (!mailbox) return;

  const client = openClient(mailbox);
  try {
    await client.connect();
  } catch (err) {
    await recordScanError(db, connectionId, err);
    return;
  }

  try {
    const lock = await client.getMailboxLock(mailbox.folder);
    try {
      const currentUidValidity =
        client.mailbox && client.mailbox.uidValidity ? client.mailbox.uidValidity : null;
      const sinceDate = new Date(Date.now() - mailbox.maxAgeDays * 24 * 60 * 60 * 1000);

      const cursorValid =
        connection.bounce_last_uidvalidity != null &&
        currentUidValidity != null &&
        BigInt(connection.bounce_last_uidvalidity) === currentUidValidity;

      let candidateUids: number[];
      if (cursorValid && connection.bounce_last_uid != null) {
        const lastUid = connection.bounce_last_uid;
        const uids = await client.search(
          { uid: `${lastUid + 1}:*`, since: sinceDate },
          { uid: true },
        );
        candidateUids = uids ? uids.filter((u) => u > lastUid) : [];
      } else {
        // First-ever run for this connection, or the mailbox's UIDVALIDITY
        // changed (server-side signal that old UIDs are no longer
        // meaningful) -- fall back to a fresh date-bounded search.
        const uids = await client.search({ since: sinceDate }, { uid: true });
        candidateUids = uids ? [...uids] : [];
      }

      candidateUids.sort((a, b) => a - b);
      if (candidateUids.length > mailbox.maxMessagesPerScan) {
        candidateUids = cursorValid
          ? candidateUids.slice(0, mailbox.maxMessagesPerScan)
          : candidateUids.slice(-mailbox.maxMessagesPerScan);
      }

      let highestProcessedUid = connection.bounce_last_uid ?? 0;
      for (let i = 0; i < candidateUids.length; i += FETCH_CHUNK_SIZE) {
        const chunk = candidateUids.slice(i, i + FETCH_CHUNK_SIZE);
        // imapflow's `source` fetch uses BODY.PEEK[] under the hood, not
        // BODY[] -- it does not set \Seen. Confirm against the installed
        // imapflow version if this is ever in question; this scanner must
        // never change mailbox read state (see module doc comment above).
        for await (const msg of client.fetch(chunk, { source: true }, { uid: true })) {
          if (msg.source) {
            try {
              const parsed = await parseReport(msg.source);
              if (parsed) await resolveAndRecordReport(db, parsed);
            } catch {
              // One malformed message shouldn't abort the whole scan.
            }
          }
          if (msg.uid > highestProcessedUid) highestProcessedUid = msg.uid;
        }
        // Persist progress after every chunk, not just at the end, so a
        // crash/restart mid-scan resumes rather than reprocessing.
        await db
          .updateTable("connections")
          .set({
            bounce_last_uid: highestProcessedUid,
            bounce_last_uidvalidity:
              currentUidValidity != null
                ? String(currentUidValidity)
                : connection.bounce_last_uidvalidity,
            bounce_error_count: 0,
            bounce_disabled_reason: null,
          })
          .where("id", "=", connectionId)
          .execute();
      }

      if (candidateUids.length === 0) {
        await db
          .updateTable("connections")
          .set({
            bounce_last_uidvalidity:
              currentUidValidity != null
                ? String(currentUidValidity)
                : connection.bounce_last_uidvalidity,
            bounce_error_count: 0,
            bounce_disabled_reason: null,
          })
          .where("id", "=", connectionId)
          .execute();
      }
    } finally {
      lock.release();
    }
    try {
      await client.logout();
    } catch {
      client.close();
    }
  } catch (err) {
    client.close();
    await recordScanError(db, connectionId, err);
  }
}
