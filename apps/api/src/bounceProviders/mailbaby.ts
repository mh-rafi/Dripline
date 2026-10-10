import type { BounceType } from "../db/types.js";
import type { BounceProvider, FetchFailuresInput, PolledFailure } from "./types.js";

// https://www.mail.baby/apidoc.html -- GET /mail/log, X-API-KEY auth.
const BASE_URL = "https://api.mailbaby.net";
const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 500;
// Newest first, so a backlog beyond this is the oldest entries -- which were
// already recorded by earlier polls when they were new.
const MAX_PAGES = 10;
// A 4xx on an undelivered row is the relay still retrying, not a bounce. Once
// it has been retrying this long it is not going to get through.
const DEFERRAL_GIVE_UP_MS = 24 * 60 * 60 * 1000;

interface MailLogEntry {
  id: string;
  to: string;
  recipient?: string | null;
  messageId?: string | null;
  time: number;
  delivered?: number | null;
  code?: number | null;
  response?: string | null;
}

interface MailLogPage {
  total: number;
  emails: MailLogEntry[];
}

async function getLog(
  apiKey: string,
  params: Record<string, string | number | undefined>,
): Promise<MailLogPage> {
  const url = new URL("/mail/log", BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    headers: { "X-API-KEY": apiKey, accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const reason =
      res.status === 401 || res.status === 403
        ? "the API key was rejected"
        : `HTTP ${res.status} ${res.statusText}`.trim();
    throw new Error(`Mail.Baby API: ${reason}`);
  }
  return (await res.json()) as MailLogPage;
}

function bracketed(messageId: string): string {
  return messageId.startsWith("<") ? messageId : `<${messageId}>`;
}

/** A 5.7.x status is the receiving server refusing *us* (policy, reputation,
 * spam filter) -- the address may be perfectly good. Treating it as a hard
 * bounce would let one blocked sending IP blocklist every Gmail subscriber, so
 * it only counts as a soft one. */
const POLICY_REJECTION = /\b5\.7\.\d{1,3}\b/;

/** Rejections the relay itself issues -- e.g. "550 domain is not configured
 * with ORIGIN IP IN SPF see mail.baby/spf" -- say nothing about the recipient.
 * Recording them as bounces would blocklist every subscriber a sender-side
 * misconfiguration happened to touch. */
const RELAY_ORIGINATED = /mail\.baby/i;

// `delivered` is 1 delivered, 0 failed, and 2 still deferring -- the docs only
// mention 0 and 1, but the `delivered=0` filter does return 2s.
function classify(entry: MailLogEntry, now: number): BounceType | null {
  if (entry.delivered === 1 || typeof entry.code !== "number") return null;
  if (RELAY_ORIGINATED.test(entry.response ?? "")) return null;
  if (entry.code >= 500 && entry.code < 600) {
    return POLICY_REJECTION.test(entry.response ?? "") ? "soft" : "hard";
  }
  if (entry.code >= 400 && entry.code < 500 && now - entry.time * 1000 > DEFERRAL_GIVE_UP_MS) {
    return "soft";
  }
  return null;
}

function apiKeyOf(settings: Record<string, unknown>): string {
  const key = settings["api_key"];
  if (typeof key !== "string" || key === "") throw new Error("Mail.Baby API key is not set");
  return key;
}

function orderIdOf(settings: Record<string, unknown>): number | undefined {
  const id = Number(settings["order_id"]);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export const mailbaby: BounceProvider = {
  key: "mailbaby",
  label: "Mail.Baby",
  description:
    "Reads the Mail.Baby delivery log (GET /mail/log) for messages the relay failed to deliver.",
  fields: [
    {
      key: "api_key",
      label: "API key",
      type: "password",
      required: true,
      help: "From my.interserver.net → Account Security. Used only to read the mail log.",
    },
    {
      key: "order_id",
      label: "Mail order ID",
      type: "number",
      placeholder: "optional",
      help: "The order this connection sends through. Leave blank to use the first active order on the account.",
    },
  ],

  async verify(settings) {
    await getLog(apiKeyOf(settings), { id: orderIdOf(settings), limit: 1 });
  },

  async fetchFailures({ settings, since }: FetchFailuresInput) {
    const apiKey = apiKeyOf(settings);
    const orderId = orderIdOf(settings);
    const startDate = Math.floor(since.getTime() / 1000);
    const now = Date.now();
    const failures: PolledFailure[] = [];

    for (let page = 0, skip = 0; page < MAX_PAGES; page++, skip += PAGE_SIZE) {
      const log = await getLog(apiKey, {
        id: orderId,
        delivered: 0,
        startDate,
        sort: "time",
        dir: "desc",
        limit: PAGE_SIZE,
        skip,
      });

      for (const entry of log.emails) {
        const type = classify(entry, now);
        const recipient = entry.recipient || entry.to;
        if (!type || !recipient) continue;
        failures.push({
          // One log row per (message, recipient): a multi-recipient message
          // shares `id`, so the address is part of the key.
          key: `mailbaby:${entry.id}:${recipient.toLowerCase()}`,
          recipient,
          messageId: entry.messageId ? bracketed(entry.messageId) : null,
          type,
          detail: entry.response ?? `SMTP ${entry.code}`,
        });
      }

      if (skip + PAGE_SIZE >= log.total || log.emails.length === 0) break;
    }
    return failures;
  },
};
