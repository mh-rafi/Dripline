import { randomUUID } from "node:crypto";
import { sql, type Selectable } from "kysely";
import type { DB } from "../db/kysely.js";
import type { Config } from "../config.js";
import type {
  CampaignContentType,
  CampaignsTable,
  CampaignStatus,
  SubscribersTable,
} from "../db/types.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { markdownToHtml } from "../lib/markdown.js";
import { renderCampaignEmail } from "./mailer.js";
import { getConnectionChain, sendWithChain } from "./connections.js";

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
 * Duplicates a campaign as a new draft: same content, lists, and connection
 * chain, but never inherits the source's status, schedule, or send
 * progress -- those describe a specific past/in-progress send, not the
 * content being copied. `campaign_emails`/analytics are never touched, so
 * the duplicate starts with zero send history of its own.
 */
export async function duplicateCampaign(db: DB, id: number) {
  const source = await getCampaignOrThrow(db, id);

  const copy = await db
    .insertInto("campaigns")
    .values({
      name: `Copy of ${source.name}`,
      subject: source.subject,
      body: source.body,
      body_source: source.body_source,
      content_type: source.content_type,
      from_email: source.from_email,
      from_name: source.from_name,
      reply_to: source.reply_to,
      template_id: source.template_id,
      rate_limit_count: source.rate_limit_count,
      rate_limit_duration_seconds: source.rate_limit_duration_seconds,
      track_opens: source.track_opens,
      track_clicks: source.track_clicks,
      // Deliberately not copied: send_at (a schedule for the original
      // send, not this one) and status (always starts as "draft").
      status: "draft",
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const lists = await db
    .selectFrom("campaign_lists")
    .select("list_id")
    .where("campaign_id", "=", id)
    .execute();
  if (lists.length > 0) {
    await db
      .insertInto("campaign_lists")
      .values(lists.map((l) => ({ campaign_id: copy.id, list_id: l.list_id })))
      .execute();
  }

  const connections = await db
    .selectFrom("campaign_connections")
    .select(["connection_id", "priority"])
    .where("campaign_id", "=", id)
    .orderBy("priority", "asc")
    .execute();
  if (connections.length > 0) {
    await db
      .insertInto("campaign_connections")
      .values(
        connections.map((c) => ({
          campaign_id: copy.id,
          connection_id: c.connection_id,
          priority: c.priority,
        })),
      )
      .execute();
  }

  return copy;
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

  const connCount = await db
    .selectFrom("campaign_connections")
    .select(db.fn.countAll().as("count"))
    .where("campaign_id", "=", id)
    .executeTakeFirst();
  if (!connCount || Number(connCount.count) === 0) {
    throw new BadRequestError("campaign has no sending connections attached");
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

export interface TestEmailOverrides {
  name?: string;
  subject?: string;
  body?: string;
  body_source?: string | null;
  content_type?: CampaignContentType;
  from_email?: string | null;
  from_name?: string | null;
  reply_to?: string | null;
  template_id?: number | null;
}

/**
 * Sends a one-off test email using the campaign's *saved connections* but
 * whatever body/subject/content_type is passed in -- so a test can be sent
 * against in-progress, unsaved edits, matching listmonk's test-send model.
 * Not part of the campaign_emails dispatch pipeline: no row is created, and
 * this doesn't count toward `to_send`/`sent`. It does still go through the
 * connection's own rate limit (sendWithChain -> sendThroughConnection), same
 * as a real send.
 */
export async function sendTestEmail(
  db: DB,
  config: Config,
  campaignId: number,
  toEmail: string,
  overrides: TestEmailOverrides,
): Promise<{ ok: boolean; error: string | null }> {
  const saved = await getCampaignOrThrow(db, campaignId);

  const campaign = {
    ...saved,
    subject: overrides.subject ?? saved.subject,
    body: overrides.body ?? saved.body,
    body_source: overrides.body_source !== undefined ? overrides.body_source : saved.body_source,
    content_type: overrides.content_type ?? saved.content_type,
    from_email: overrides.from_email !== undefined ? overrides.from_email : saved.from_email,
    from_name: overrides.from_name !== undefined ? overrides.from_name : saved.from_name,
    reply_to: overrides.reply_to !== undefined ? overrides.reply_to : saved.reply_to,
    template_id: overrides.template_id !== undefined ? overrides.template_id : saved.template_id,
  };

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

  const chain = await getConnectionChain(db, campaignId);
  if (chain.length === 0) {
    return { ok: false, error: "campaign has no sending connections attached" };
  }

  // Use the real subscriber if the test address happens to be one (so merge
  // fields preview with real data), otherwise a synthetic, non-persisted
  // stand-in -- test sends should work for any address, not just subscribers.
  const existing = await db
    .selectFrom("subscribers")
    .selectAll()
    .where("email", "=", toEmail)
    .executeTakeFirst();
  const subscriber = existing ?? syntheticSubscriber(toEmail, overrides.name ?? "Test Subscriber");

  const rendered = await renderCampaignEmail(db, config, campaign, template ?? null, subscriber);
  const result = await sendWithChain(db, chain, {
    to: toEmail,
    subject: rendered.subject,
    html: rendered.html,
    fromOverride: campaign.from_email,
    fromNameOverride: campaign.from_name,
    replyTo: campaign.reply_to,
    unsubscribeUrl: rendered.unsubscribeUrl,
  });

  return { ok: result.ok, error: result.error };
}

// Cast: Kysely's `Generated<Timestamp>` double-wraps ColumnType (Timestamp is
// itself a ColumnType), which its own `Selectable<>` utility only unwraps one
// level -- harmless here since renderCampaignEmail never reads these fields.
function syntheticSubscriber(email: string, name: string): Selectable<SubscribersTable> {
  return {
    id: 0,
    uuid: randomUUID(),
    email,
    name,
    attribs: {},
    status: "enabled",
    created_at: new Date(),
    updated_at: new Date(),
  } as unknown as Selectable<SubscribersTable>;
}

export interface PreviewInput {
  subject?: string;
  body: string;
  body_source?: string | null;
  content_type?: CampaignContentType;
  template_id?: number | null;
}

/**
 * Renders a campaign body for preview -- same rendering path as a real send
 * (renderCampaignEmail, so tracking links/open pixel/unsubscribe link are
 * all present exactly as they'd be for a recipient), but against a
 * synthetic, non-persisted campaign and subscriber. Unlike sendTestEmail,
 * this needs no saved campaign row and no sending connection -- it works
 * for a brand new, never-saved campaign draft, matching listmonk's preview.
 */
export async function previewCampaign(
  db: DB,
  config: Config,
  input: PreviewInput,
): Promise<{ subject: string; html: string }> {
  const content_type = input.content_type ?? "richtext";
  const body = content_type === "markdown" ? markdownToHtml(input.body) : input.body;

  const template = input.template_id
    ? await db
        .selectFrom("templates")
        .selectAll()
        .where("id", "=", input.template_id)
        .executeTakeFirst()
    : null;

  const campaign = {
    id: 0,
    uuid: randomUUID(),
    name: "Preview",
    subject: input.subject ?? "",
    body,
    content_type,
    track_opens: true,
    track_clicks: true,
  } as unknown as Selectable<CampaignsTable>;

  const subscriber = syntheticSubscriber("preview@example.com", "Preview Subscriber");
  const rendered = await renderCampaignEmail(db, config, campaign, template ?? null, subscriber);
  return { subject: rendered.subject, html: rendered.html };
}
