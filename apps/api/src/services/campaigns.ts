import { sql } from "kysely";
import type { DB } from "../db/kysely.js";
import type { CampaignStatus } from "../db/types.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";

const ALLOWED_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ["scheduled", "running", "cancelled"],
  scheduled: ["draft", "running", "cancelled"],
  running: ["paused", "cancelled"],
  paused: ["running", "cancelled"],
  finished: [],
  cancelled: [],
};

export async function getCampaignOrThrow(db: DB, id: number) {
  const campaign = await db
    .selectFrom("campaigns")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!campaign) throw new NotFoundError("campaign");
  return campaign;
}

/**
 * Materializes campaign_emails rows for every currently-eligible subscriber
 * across the campaign's lists. Idempotent (ON CONFLICT DO NOTHING) so it's
 * safe to call again on resume -- e.g. after list membership changed while
 * paused, new members are picked up without touching existing rows.
 */
async function enqueueEligibleRecipients(db: DB, campaignId: number): Promise<number> {
  const result = await sql<{ inserted: number }>`
    WITH inserted AS (
      INSERT INTO campaign_emails (campaign_id, subscriber_id, status)
      SELECT DISTINCT ${campaignId}::int, s.id, 'pending'
      FROM subscribers s
      JOIN subscriber_lists sl ON sl.subscriber_id = s.id
      JOIN campaign_lists cl ON cl.list_id = sl.list_id AND cl.campaign_id = ${campaignId}
      JOIN lists l ON l.id = sl.list_id
      WHERE s.status != 'blocklisted'
        AND (
          (l.optin = 'double' AND sl.status = 'confirmed') OR
          (l.optin != 'double' AND sl.status != 'unsubscribed')
        )
      ON CONFLICT (campaign_id, subscriber_id) DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*)::int AS inserted FROM inserted
  `.execute(db);

  return result.rows[0]?.inserted ?? 0;
}

function assertTransition(from: CampaignStatus, to: CampaignStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new BadRequestError(`cannot move campaign from '${from}' to '${to}'`);
  }
}

export async function startCampaign(db: DB, id: number) {
  const campaign = await getCampaignOrThrow(db, id);
  assertTransition(campaign.status, "running");

  const listCount = await db
    .selectFrom("campaign_lists")
    .select(db.fn.countAll().as("count"))
    .where("campaign_id", "=", id)
    .executeTakeFirst();
  if (!listCount || Number(listCount.count) === 0) {
    throw new BadRequestError("campaign has no lists attached");
  }

  await enqueueEligibleRecipients(db, id);

  const toSend = await db
    .selectFrom("campaign_emails")
    .select(db.fn.countAll().as("count"))
    .where("campaign_id", "=", id)
    .executeTakeFirst();

  await db
    .updateTable("campaigns")
    .set({
      status: "running",
      to_send: Number(toSend?.count ?? 0),
      started_at: campaign.started_at ?? new Date(),
    })
    .where("id", "=", id)
    .execute();

  return getCampaignOrThrow(db, id);
}

export async function pauseCampaign(db: DB, id: number) {
  const campaign = await getCampaignOrThrow(db, id);
  assertTransition(campaign.status, "paused");
  await db.updateTable("campaigns").set({ status: "paused" }).where("id", "=", id).execute();
  return getCampaignOrThrow(db, id);
}

export async function cancelCampaign(db: DB, id: number) {
  const campaign = await getCampaignOrThrow(db, id);
  assertTransition(campaign.status, "cancelled");
  await db.updateTable("campaigns").set({ status: "cancelled" }).where("id", "=", id).execute();
  return getCampaignOrThrow(db, id);
}

export interface CampaignProgress {
  pending: number;
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  total: number;
}

/** Live progress computed from campaign_emails -- never a cached counter. */
export async function getCampaignProgress(db: DB, campaignId: number): Promise<CampaignProgress> {
  const rows = await db
    .selectFrom("campaign_emails")
    .select(["status", db.fn.countAll().as("count")])
    .where("campaign_id", "=", campaignId)
    .groupBy("status")
    .execute();

  const progress: CampaignProgress = {
    pending: 0,
    queued: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    total: 0,
  };
  for (const row of rows) {
    const count = Number(row.count);
    progress[row.status] = count;
    progress.total += count;
  }
  return progress;
}
