import type { Config } from "../config.js";
import type { DB } from "../db/kysely.js";
import { hashPassword } from "../lib/password.js";
import { SUPER_ADMIN_ROLE_ID } from "../lib/permissions.js";

export interface DemoSeedResult {
  seeded: boolean;
}

const FIRST_NAMES = [
  "Ava",
  "Liam",
  "Maya",
  "Noah",
  "Sofia",
  "Ethan",
  "Priya",
  "Lucas",
  "Zoe",
  "Mateo",
  "Nina",
  "Oscar",
  "Hana",
  "Theo",
  "Grace",
  "Kai",
  "Elena",
  "Marcus",
  "Ines",
  "Dylan",
];
const LAST_NAMES = [
  "Carter",
  "Nguyen",
  "Patel",
  "Kowalski",
  "Rossi",
  "Muller",
  "Silva",
  "Andersson",
  "Kim",
  "Dubois",
  "Novak",
  "Haddad",
  "Larsen",
  "Ferreira",
  "Okafor",
];
// example.{com,org,net} are reserved for documentation (RFC 2606), so these
// never resolve to a real inbox -- important since demo data ships in every
// public demo deployment.
const EMAIL_DOMAINS = ["example.com", "example.org", "example.net"];
const TAG_POOL = ["customer", "trial", "newsletter", "vip", "beta"];

function pick<T>(items: readonly T[], index: number): T {
  return items[index % items.length]!;
}

function shuffledSubset<T>(items: readonly T[], count: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, Math.min(count, copy.length));
}

function campaignBody(heading: string, intro: string, ctaText: string, ctaUrl: string): string {
  return `<p>Hi {{Subscriber.Name}},</p>
<h2>${heading}</h2>
<p>${intro}</p>
<p><a href="${ctaUrl}">${ctaText}</a></p>
<p>-- The Dripline team</p>`;
}

/**
 * Populates a demo deployment with sample lists, subscribers and campaigns so
 * a public IS_DEMO=true instance isn't an empty shell. Runs once: a non-empty
 * `lists` table means an earlier start already seeded it (or a real admin has
 * since added real lists), either way nothing here should run again.
 */
export async function seedDemo(db: DB, config: Config): Promise<DemoSeedResult> {
  const existingList = await db.selectFrom("lists").select("id").limit(1).executeTakeFirst();
  if (existingList) return { seeded: false };

  const noUsersYet = !(await db.selectFrom("users").select("id").limit(1).executeTakeFirst());
  if (noUsersYet) {
    await db
      .insertInto("users")
      .values({
        email: config.demoAdminEmail,
        password_hash: await hashPassword(config.demoAdminPassword),
        name: "Demo Admin",
        role_id: SUPER_ADMIN_ROLE_ID,
      })
      .execute();
  }

  const lists = await db
    .insertInto("lists")
    .values([
      { name: "Newsletter", type: "public", optin: "single", description: "Weekly product news" },
      {
        name: "Product Updates",
        type: "public",
        optin: "single",
        description: "Release notes and changelog",
      },
      {
        name: "VIP Customers",
        type: "private",
        optin: "single",
        description: "Top-tier accounts",
      },
      {
        name: "Webinar Signups",
        type: "public",
        optin: "double",
        description: "Registered for a live demo",
      },
      {
        name: "Trial Users",
        type: "private",
        optin: "single",
        description: "Active 14-day trials",
      },
    ])
    .returningAll()
    .execute();
  const [newsletter, productUpdates, vip, webinar, trial] = lists;

  const subscribers = await db
    .insertInto("subscribers")
    .values(
      FIRST_NAMES.flatMap((first, i) =>
        LAST_NAMES.slice(0, 2).map((_, j) => {
          const last = pick(LAST_NAMES, i + j);
          const domain = pick(EMAIL_DOMAINS, i + j);
          const tagCount = (i + j) % 3;
          return {
            email: `${first.toLowerCase()}.${last.toLowerCase()}${j}@${domain}`,
            name: `${first} ${last}`,
            tags: shuffledSubset(TAG_POOL, tagCount),
          };
        }),
      ),
    )
    .returningAll()
    .execute();

  // Single opt-in lists auto-confirm, mirroring what actually happens when a
  // subscriber joins one for real. The double opt-in list is left mostly
  // unconfirmed, since that's the realistic state for one.
  async function enroll(
    listId: number,
    subscriberIds: number[],
    status: "confirmed" | "unconfirmed",
  ) {
    if (subscriberIds.length === 0) return;
    await db
      .insertInto("subscriber_lists")
      .values(subscriberIds.map((subscriber_id) => ({ subscriber_id, list_id: listId, status })))
      .execute();
  }

  const allIds = subscribers.map((s) => s.id);
  const newsletterMembers = shuffledSubset(allIds, 24);
  const productMembers = shuffledSubset(allIds, 18);
  const vipMembers = shuffledSubset(allIds, 8);
  const trialMembers = shuffledSubset(allIds, 10);
  const webinarConfirmed = shuffledSubset(allIds, 6);
  const webinarUnconfirmed = shuffledSubset(
    allIds.filter((id) => !webinarConfirmed.includes(id)),
    9,
  );

  await enroll(newsletter!.id, newsletterMembers, "confirmed");
  await enroll(productUpdates!.id, productMembers, "confirmed");
  await enroll(vip!.id, vipMembers, "confirmed");
  await enroll(trial!.id, trialMembers, "confirmed");
  await enroll(webinar!.id, webinarConfirmed, "confirmed");
  await enroll(webinar!.id, webinarUnconfirmed, "unconfirmed");
  // A couple of departures so list detail pages show something under
  // "unsubscribed" too, not just growth.
  await db
    .updateTable("subscriber_lists")
    .set({ status: "unsubscribed" })
    .where("list_id", "=", newsletter!.id)
    .where("subscriber_id", "in", shuffledSubset(newsletterMembers, 2))
    .execute();

  // Fabricates a "finished" campaign's history directly in campaign_emails /
  // campaign_views / link_clicks, since the real dispatch engine never ran
  // for it -- see docs comment on why the campaigns.sent/to_send columns
  // themselves are left at their defaults (the API recomputes them live).
  async function seedFinishedCampaign(opts: {
    name: string;
    subject: string;
    listId: number;
    recipients: number[];
    body: string;
    ctaUrl: string;
    daysAgo: number;
    sendRate: number;
    openRate: number;
    clickRate: number;
  }) {
    const sentAt = new Date(Date.now() - opts.daysAgo * 86_400_000);
    const campaign = await db
      .insertInto("campaigns")
      .values({
        name: opts.name,
        subject: opts.subject,
        body: opts.body,
        body_source: opts.body,
        content_type: "richtext",
        status: "finished",
        started_at: sentAt,
        finished_at: new Date(sentAt.getTime() + 15 * 60_000),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await db
      .insertInto("campaign_lists")
      .values({ campaign_id: campaign.id, list_id: opts.listId })
      .execute();

    const link = await db
      .insertInto("links")
      .values({ url: opts.ctaUrl })
      .returningAll()
      .executeTakeFirstOrThrow();

    const sentTo = shuffledSubset(
      opts.recipients,
      Math.round(opts.recipients.length * opts.sendRate),
    );
    const failed = shuffledSubset(
      opts.recipients.filter((id) => !sentTo.includes(id)),
      Math.max(0, Math.round(opts.recipients.length * 0.04)),
    );
    await db
      .insertInto("campaign_emails")
      .values([
        ...sentTo.map((subscriber_id) => ({
          campaign_id: campaign.id,
          subscriber_id,
          status: "sent" as const,
          sent_at: sentAt,
        })),
        ...failed.map((subscriber_id) => ({
          campaign_id: campaign.id,
          subscriber_id,
          status: "failed" as const,
          error: "connection timed out",
        })),
      ])
      .execute();

    const openers = shuffledSubset(sentTo, Math.round(sentTo.length * opts.openRate));
    await db
      .insertInto("campaign_views")
      .values(
        openers.flatMap((subscriber_id) => {
          // A third of openers check the email twice, so "opens" reads
          // higher than "unique opens" like a real inbox would produce.
          const rows = [{ campaign_id: campaign.id, subscriber_id }];
          if (Math.random() < 0.33) rows.push({ campaign_id: campaign.id, subscriber_id });
          return rows;
        }),
      )
      .execute();

    const clickers = shuffledSubset(openers, Math.round(openers.length * opts.clickRate));
    if (clickers.length > 0) {
      await db
        .insertInto("link_clicks")
        .values(
          clickers.map((subscriber_id) => ({
            link_id: link.id,
            campaign_id: campaign.id,
            subscriber_id,
          })),
        )
        .execute();
    }

    return campaign;
  }

  await seedFinishedCampaign({
    name: "Welcome to Dripline",
    subject: "Welcome aboard!",
    listId: newsletter!.id,
    recipients: newsletterMembers,
    body: campaignBody(
      "Thanks for subscribing",
      "Here's a quick look at what Dripline can do for your next campaign.",
      "Explore the docs",
      "https://dripline.example.com/docs",
    ),
    ctaUrl: "https://dripline.example.com/docs",
    daysAgo: 21,
    sendRate: 0.95,
    openRate: 0.62,
    clickRate: 0.3,
  });

  await seedFinishedCampaign({
    name: "October Product Roundup",
    subject: "What's new this month",
    listId: productUpdates!.id,
    recipients: productMembers,
    body: campaignBody(
      "New this month",
      "Automation reporting, bulk subscriber actions and a refreshed campaign editor just shipped.",
      "See the changelog",
      "https://dripline.example.com/changelog",
    ),
    ctaUrl: "https://dripline.example.com/changelog",
    daysAgo: 6,
    sendRate: 0.97,
    openRate: 0.54,
    clickRate: 0.22,
  });

  const sneakPeek = await db
    .insertInto("campaigns")
    .values({
      name: "Black Friday Sneak Peek",
      subject: "A first look, just for VIPs",
      body: campaignBody(
        "You're getting this early",
        "Black Friday pricing goes out to everyone else next week -- you get it now.",
        "See the preview",
        "https://dripline.example.com/black-friday",
      ),
      body_source: "",
      content_type: "richtext",
      status: "scheduled",
      send_at: new Date(Date.now() + 3 * 86_400_000),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await db
    .insertInto("campaign_lists")
    .values({ campaign_id: sneakPeek.id, list_id: vip!.id })
    .execute();

  await db
    .insertInto("campaigns")
    .values({
      name: "New Feature: Visual Automation Builder",
      subject: "Build automations without writing a single trigger by hand",
      body: campaignBody(
        "Drag, drop, done",
        "The new node-graph builder is in early access -- draft this one while it's still cooking.",
        "Read the sneak peek",
        "https://dripline.example.com/roadmap",
      ),
      body_source: "",
      content_type: "richtext",
      status: "draft",
    })
    .execute();

  return { seeded: true };
}
