import { sql } from "kysely";
import type PgBoss from "pg-boss";
import type { DB } from "../db/kysely.js";
import type { Config } from "../config.js";
import { mapLimit } from "../lib/concurrency.js";
import { renderCampaignEmail } from "../services/mailer.js";
import { sendWithFailover } from "../services/providerRouter.js";
import { QUEUES } from "./boss.js";

const SEND_CONCURRENCY = 5;

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

    const template = campaign.template_id
      ? await db
          .selectFrom("templates")
          .selectAll()
          .where("id", "=", campaign.template_id)
          .executeTakeFirst()
      : null;

    const batch = await claimBatch(db, campaignId, campaign.messages_per_minute);
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
      const result = await sendWithFailover(db, {
        to: subscriber.email,
        subject: rendered.subject,
        html: rendered.html,
        fromOverride: campaign.from_email,
      });

      await db
        .updateTable("campaign_emails")
        .set({
          status: result.ok ? "sent" : "failed",
          provider_id: result.providerId,
          error: result.error,
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
