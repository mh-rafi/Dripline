import nodemailer, { type Transporter } from "nodemailer";
import type { DB } from "../db/kysely.js";
import type { ProvidersTable, SmtpProviderConfig } from "../db/types.js";
import type { Selectable } from "kysely";

type Provider = Selectable<ProvidersTable>;

const transporterCache = new Map<number, Transporter>();

function getTransporter(provider: Provider): Transporter {
  const cached = transporterCache.get(provider.id);
  if (cached) return cached;

  const cfg = provider.config as SmtpProviderConfig;
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure ?? cfg.port === 465,
    auth: cfg.username ? { user: cfg.username, pass: cfg.password } : undefined,
  });
  transporterCache.set(provider.id, transporter);
  return transporter;
}

/** Drop a provider's cached transporter, e.g. after its config is edited. */
export function invalidateTransporter(providerId: number): void {
  transporterCache.delete(providerId);
}

/** Weighted-random ordering of currently-enabled providers, for failover attempts. */
export async function getProviderOrder(db: DB): Promise<Provider[]> {
  const providers = await db
    .selectFrom("providers")
    .selectAll()
    .where("enabled", "=", true)
    .execute();

  const pool = [...providers];
  const ordered: Provider[] = [];
  while (pool.length > 0) {
    const totalWeight = pool.reduce((sum, p) => sum + p.weight, 0);
    let roll = Math.random() * totalWeight;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      roll -= pool[idx]!.weight;
      if (roll <= 0) break;
    }
    const [picked] = pool.splice(Math.min(idx, pool.length - 1), 1);
    if (picked) ordered.push(picked);
  }
  return ordered;
}

export interface SendResult {
  ok: boolean;
  providerId: number | null;
  error: string | null;
}

export interface SendInput {
  to: string;
  subject: string;
  html: string;
  fromOverride?: string | null;
}

/**
 * Sends through providers in weighted order, failing over to the next enabled
 * provider on error. Records success/error counts and auto-disables a provider
 * once it crosses its max_errors threshold.
 */
export async function sendWithFailover(db: DB, input: SendInput): Promise<SendResult> {
  const providers = await getProviderOrder(db);
  if (providers.length === 0) {
    return { ok: false, providerId: null, error: "no enabled sending providers configured" };
  }

  let lastError: string | null = null;
  for (const provider of providers) {
    try {
      const transporter = getTransporter(provider);
      await transporter.sendMail({
        from: input.fromOverride || provider.from_email,
        to: input.to,
        subject: input.subject,
        html: input.html,
      });
      await recordProviderResult(db, provider.id, true);
      return { ok: true, providerId: provider.id, error: null };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await recordProviderResult(db, provider.id, false);
    }
  }

  return { ok: false, providerId: null, error: lastError ?? "all providers failed" };
}

async function recordProviderResult(db: DB, providerId: number, success: boolean): Promise<void> {
  if (success) {
    await db
      .updateTable("providers")
      .set({ error_count: 0 })
      .where("id", "=", providerId)
      .execute();
    return;
  }

  const provider = await db
    .selectFrom("providers")
    .select(["error_count", "max_errors"])
    .where("id", "=", providerId)
    .executeTakeFirst();
  if (!provider) return;

  const errorCount = provider.error_count + 1;
  const shouldDisable = errorCount >= provider.max_errors;

  await db
    .updateTable("providers")
    .set({
      error_count: errorCount,
      ...(shouldDisable
        ? {
            enabled: false,
            disabled_reason: `auto-disabled after ${errorCount} consecutive errors`,
          }
        : {}),
    })
    .where("id", "=", providerId)
    .execute();
}
