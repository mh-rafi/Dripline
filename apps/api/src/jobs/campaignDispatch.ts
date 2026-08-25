import { sql } from "kysely";
import type { PgBoss } from "pg-boss";
import type { DB } from "../db/kysely.js";
import type { Config } from "../config.js";
import { mapLimit } from "../lib/concurrency.js";
import { markdownToHtml } from "../lib/markdown.js";
import { renderCampaignEmail } from "../services/mailer.js";
import { getConnectionChain, sendWithChain } from "../services/connections.js";
import { reserveCampaignSendSlots } from "../services/rateLimiter.js";
import { QUEUES } from "./boss.js";

const SEND_CONCURRENCY = 5;
// Per-tick ceiling when a campaign has no rate_limit_count of its own -- the
// connection's own (primary) rate limit is still what actually gates delivery.
const MAX_CLAIM_PER_TICK = 1000;

interface DispatchJob {
  campaignId: number;
}

interface ClaimedRow {
  id: string;
  subscriber_id: number;
}

/** Claims up to `limit` pending rows for a campaign, marking them 'queued'. Concurrency-safe. */
async function claimBatch(db: DB, campaignId: number, limit: number): Promise<ClaimedRow[]> {
  const result = await sql<ClaimedRow>`
    WITH claimed AS (
      SELECT id FROM campaign_emails
      WHERE campaign_id = ${campaignId} AND status = 'pending'
      ORDER BY id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE campaign_emails
    SET status = 'queued'
    FROM claimed
    WHERE campaign_emails.id = claimed.id
    RETURNING campaign_emails.id, campaign_emails.subscriber_id
  `.execute(db);
  return result.rows;
}

async function finalizeIfExhausted(db: DB, campaignId: number): Promise<void> {
  const remaining = await db
    .selectFrom("campaign_emails")
    .select(db.fn.countAll().as("count"))
    .where("campaign_id", "=", campaignId)
    .where("status", "in", ["pending", "queued"])
    .executeTakeFirst();

  if (Number(remaining?.count ?? 0) > 0) return;

  // Only a still-running campaign transitions to finished here -- if it was
  // paused/cancelled in the meantime, leave its status alone.
  await db
    .updateTable("campaigns")
    .set({ status: "finished", finished_at: new Date() })
    .where("id", "=", campaignId)
    .where("status", "=", "running")
    .execute();
}

export function registerCampaignDispatchWorker(
  boss: PgBoss,
  db: DB,
  config: Config,
): Promise<string> {
  return boss.work<DispatchJob>(QUEUES.CAMPAIGN_DISPATCH_BATCH, async ([job]) => {
    if (!job) return;
    const { campaignId } = job.data;

    const campaign = await db
      .selectFrom("campaigns")
      .selectAll()
      .where("id", "=", campaignId)
      .executeTakeFirst();
    if (!campaign || campaign.status !== "running") return;

    // Markdown is converted to HTML once per batch (not per recipient) --
    // it's subscriber-independent, and this happens *before* the per-subscriber
    // merge-field render so `{{ Subscriber.Name }}` written inside markdown
    // text survives conversion untouched and still gets substituted below.
    // richtext/html/visual already store final HTML in `body`; plain is sent
    // as-is.
    if (campaign.content_type === "markdown") {
      campaign.body = markdownToHtml(campaign.body);
    }

    const template = campaign.template_id
      ? await db
          .selectFrom("templates")
          .selectAll()
          .where("id", "=", campaign.template_id)
          .executeTakeFirst()
      : null;

    // Resolve this campaign's explicit connection chain (primary -> fallbacks).
    // If it has none configured (e.g. all its connections were deleted), there's
    // nothing to send through -- leave recipients pending and stop this tick.
    const chain = await getConnectionChain(db, campaignId);
    if (chain.length === 0) {
      await finalizeIfExhausted(db, campaignId);
      return;
    }

    // The campaign throttle is a *secondary*, optional cap -- reserved as a
    // fixed-window slot count so "1 per 5 minutes" works correctly even
    // though this tick runs every minute (most ticks reserve 0 slots and
    // claim nothing). The connection's own rate limit, enforced per-send
    // inside sendWithChain, is the authoritative, globally-shared one.
    const slots = await reserveCampaignSendSlots(db, campaignId, MAX_CLAIM_PER_TICK);
    const batch = slots > 0 ? await claimBatch(db, campaignId, slots) : [];
    if (batch.length === 0) {
      await finalizeIfExhausted(db, campaignId);
      return;
    }

    await mapLimit(batch, SEND_CONCURRENCY, async (row) => {
      const subscriber = await db
        .selectFrom("subscribers")
        .selectAll()
        .where("id", "=", row.subscriber_id)
        .executeTakeFirst();
      if (!subscriber) {
        await db
          .updateTable("campaign_emails")
          .set({ status: "skipped", error: "subscriber no longer exists" })
          .where("id", "=", row.id)
          .execute();
        return;
      }

      const rendered = await renderCampaignEmail(
        db,
        config,
        campaign,
        template ?? null,
        subscriber,
      );
      const result = await sendWithChain(db, chain, {
        to: subscriber.email,
        subject: rendered.subject,
        html: rendered.html,
        fromOverride: campaign.from_email,
        unsubscribeUrl: rendered.unsubscribeUrl,
      });

      // A rate-limited send is not a delivery failure: revert the row to
      // pending so the next tick reclaims it, without burning a retry attempt.
      if (!result.ok && result.error === "rate_limited") {
        await db
          .updateTable("campaign_emails")
          .set({ status: "pending", error: null })
          .where("id", "=", row.id)
          .execute();
        return;
      }

      await db
        .updateTable("campaign_emails")
        .set({
          status: result.ok ? "sent" : "failed",
          connection_id: result.connectionId,
          error: result.error,
          message_id: result.messageId,
          sent_at: result.ok ? new Date() : null,
          attempts: sql`attempts + 1`,
        })
        .where("id", "=", row.id)
        .execute();
    });

    await finalizeIfExhausted(db, campaignId);
  });
}

/** Runs every minute: enqueues one dispatch-batch job per running campaign, deduped
 * via singletonKey so a slow batch never overlaps with the next scan tick. */
export async function scheduleCampaignScan(boss: PgBoss): Promise<void> {
  await boss.schedule(QUEUES.CAMPAIGN_SCAN, "* * * * *");
}

export function registerCampaignScanWorker(boss: PgBoss, db: DB): Promise<string> {
  return boss.work(QUEUES.CAMPAIGN_SCAN, async () => {
    const running = await db
      .selectFrom("campaigns")
      .select("id")
      .where("status", "=", "running")
      .execute();
    for (const { id } of running) {
      await boss.send(QUEUES.CAMPAIGN_DISPATCH_BATCH, { campaignId: id } satisfies DispatchJob, {
        singletonKey: `campaign-${id}`,
        singletonSeconds: 55,
      });
    }
  });
}
