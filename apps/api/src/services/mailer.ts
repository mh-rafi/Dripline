import type { DB } from "../db/kysely.js";
import type { Config } from "../config.js";
import type { Selectable } from "kysely";
import type { CampaignsTable, SubscribersTable, TemplatesTable } from "../db/types.js";
import { appendOpenPixel, extractLinks, renderTemplate, rewriteLinks } from "../lib/template.js";
import { sign } from "../lib/signing.js";

type Campaign = Selectable<CampaignsTable>;
type Subscriber = Selectable<SubscribersTable>;
type Template = Selectable<TemplatesTable>;

export interface RenderedEmail {
  subject: string;
  html: string;
}

function unsubscribeUrl(config: Config, subscriber: Subscriber, campaign: Campaign): string {
  const sig = sign(config.trackingSecret, [subscriber.uuid, campaign.uuid]);
  return `${config.appUrl}/api/v1/unsubscribe/${campaign.uuid}/${subscriber.uuid}?sig=${sig}`;
}

function openPixelUrl(config: Config, subscriber: Subscriber, campaign: Campaign): string {
  const sig = sign(config.trackingSecret, [subscriber.uuid, campaign.uuid, "open"]);
  return `${config.appUrl}/api/v1/track/open/${campaign.uuid}/${subscriber.uuid}?sig=${sig}`;
}

function clickUrl(
  config: Config,
  subscriber: Subscriber,
  campaign: Campaign,
  targetUrl: string,
): string {
  const sig = sign(config.trackingSecret, [subscriber.uuid, campaign.uuid, targetUrl]);
  return `${config.appUrl}/api/v1/track/click/${campaign.uuid}/${subscriber.uuid}?url=${encodeURIComponent(
    targetUrl,
  )}&sig=${sig}`;
}

/**
 * Renders a campaign's body for one subscriber: merge fields, click-tracked
 * links (registered in `links` for later resolution), and an open pixel.
 */
export async function renderCampaignEmail(
  db: DB,
  config: Config,
  campaign: Campaign,
  template: Template | null,
  subscriber: Subscriber,
): Promise<RenderedEmail> {
  const context = {
    Subscriber: {
      ID: subscriber.id,
      UUID: subscriber.uuid,
      Email: subscriber.email,
      Name: subscriber.name,
      Attribs: subscriber.attribs,
    },
    Campaign: {
      ID: campaign.id,
      UUID: campaign.uuid,
      Name: campaign.name,
      Subject: campaign.subject,
    },
    UnsubscribeURL: unsubscribeUrl(config, subscriber, campaign),
  };

  const body = template ? template.body.replace("{{ Body }}", campaign.body) : campaign.body;

  // Plain-text campaigns skip HTML-specific processing entirely -- no open
  // pixel, no link-tracking rewrite (there's nothing resembling <a href> to
  // find anyway), and merge fields are substituted directly against the
  // literal text. The result is escaped and wrapped in <pre> so the single
  // HTML part renders as plain text rather than being interpreted as markup
  // (a genuine multipart text/plain part is a possible future improvement --
  // see docs/plan/DEVELOPMENT_PLAN.md).
  if (campaign.content_type === "plain") {
    const text = renderTemplate(body, context);
    const html = `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(text)}</pre>`;
    return { subject: renderTemplate(campaign.subject, context), html };
  }

  let html = renderTemplate(body, context);

  // The unsubscribe link is rendered before extraction/tracking so it can be
  // excluded below -- it must never be wrapped in click-tracking, or an
  // unsubscribe click would log a spurious "link click" (and could even fire
  // a link_clicked workflow trigger) before redirecting.
  const unsubUrl = context.UnsubscribeURL;

  const links = extractLinks(html).filter((url) => url !== unsubUrl);
  if (links.length > 0) {
    await db
      .insertInto("links")
      .values(links.map((url) => ({ url })))
      .onConflict((oc) => oc.column("url").doNothing())
      .execute();
  }
  html = rewriteLinks(html, (url) =>
    url === unsubUrl ? undefined : clickUrl(config, subscriber, campaign, url),
  );
  html = appendOpenPixel(html, openPixelUrl(config, subscriber, campaign));

  return { subject: renderTemplate(campaign.subject, context), html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
