import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { Selectable } from "kysely";
import type { DB } from "../db/kysely.js";
import type { ConnectionsTable, SmtpConnectionConfig } from "../db/types.js";
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

// ---- DSN parsing -------------------------------------------------------------

interface ParsedBounce {
  type: "hard" | "soft";
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
 * Parses a raw fetched message and extracts bounce info, or null if it
 * doesn't look like a DSN (RFC 3464) at all -- the common case for
 * everything else sitting in a shared/noisy mailbox, discarded cheaply
 * without being written anywhere. See
 * docs/plan/mailbox_bounce_scanning.md §2 for the two-tier correlation
 * strategy this feeds into (Message-ID match, then address fallback).
 */
async function parseBounce(raw: Buffer): Promise<ParsedBounce | null> {
  const parsed = await simpleParser(raw);
  const contentType = headerValue(parsed.headers, "content-type");
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

/** Resolves a parsed bounce to a subscriber/campaign and records it via the
 * existing recordBounce() -- Message-ID match first (exact subscriber +
 * campaign), recipient-address fallback second (subscriber only,
 * campaign_id: null). No match at all: silently dropped, same as a
 * non-DSN message. */
async function resolveAndRecordBounce(db: DB, parsed: ParsedBounce): Promise<void> {
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
 * run, classifies any that look like DSNs, and records matches via
 * recordBounce(). Never marks messages \Seen, moves, or deletes anything --
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
              const parsed = await parseBounce(msg.source);
              if (parsed) await resolveAndRecordBounce(db, parsed);
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
