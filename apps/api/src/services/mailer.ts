import type { DB } from "../db/kysely.js";
import type { Config } from "../config.js";
import type { Selectable } from "kysely";
import type { CampaignsTable, SubscribersTable, TemplatesTable } from "../db/types.js";
import { appendOpenPixel, extractLinks, renderTemplate, rewriteLinks } from "../lib/template.js";
import { htmlToText } from "../lib/htmlToText.js";
import {
  clickUrl,
  openPixelUrl,
  unsubscribeOneClickUrl,
  unsubscribePageUrl,
  unsubscribeRef,
} from "../lib/trackingUrls.js";

type Campaign = Selectable<CampaignsTable>;
type Subscriber = Selectable<SubscribersTable>;
type Template = Selectable<TemplatesTable>;

export interface RenderedEmail {
  subject: string;
  /** The rendered preheader text, separately from `html` -- it's baked into
   * a hidden div there too, but callers building an inbox-style preview (see
   * PreviewModal) need the plain text on its own. */
  preheader: string;
  /** Empty for a plain-text campaign, which sends `text` as its only part. */
  html: string;
  /** The text/plain alternative. Never empty -- an HTML-only message carries a
   * standing SpamAssassin penalty. From the campaign's `alt_body` when one is
   * set, otherwise derived from the rendered HTML. */
  text: string;
  unsubscribeUrl: string;
}

/**
 * Hidden inbox-preview snippet, prepended just inside <body> (or at the very
 * top if the body has no template wrapper). `display:none` hides it from the
 * opened email; the repeated zero-width/non-breaking-space pairs pad out the
 * snippet so a mail client that ignores `display:none` for preview purposes
 * (several do) doesn't fall through into the visible body text and show a
 * mix of the two.
 */
function injectPreheader(html: string, preheader: string): string {
  if (!preheader) return html;
  const hidden =
    `<div style="display:none;max-height:0;max-width:0;overflow:hidden;font-size:1px;line-height:1px;color:transparent;opacity:0;mso-hide:all;">` +
    `${escapeHtml(preheader)}` +
    `${"&zwnj;&nbsp;".repeat(80)}` +
    `</div>`;
  const bodyOpenTag = html.match(/<body[^>]*>/i);
  if (!bodyOpenTag) return hidden + html;
  const insertAt = bodyOpenTag.index! + bodyOpenTag[0].length;
  return html.slice(0, insertAt) + hidden + html.slice(insertAt);
}

/**
 * Interns a batch of destination URLs and hands back their `links` ids, which
 * is what a tracked click URL carries now -- the destination itself used to be
 * URL-encoded into the query string, and on its own pushed those links past
 * the length SpamAssassin penalizes.
 */
export async function resolveLinkIds(db: DB, urls: string[]): Promise<Map<string, number>> {
  if (urls.length === 0) return new Map();
  const rows = await db
    .insertInto("links")
    .values(urls.map((url) => ({ url })))
    // A no-op update rather than doNothing: RETURNING skips rows that a
    // doNothing conflict discards, and the ids of already-known links are
    // exactly what this needs back.
    .onConflict((oc) => oc.column("url").doUpdateSet((eb) => ({ url: eb.ref("excluded.url") })))
    .returning(["id", "url"])
    .execute();
  return new Map(rows.map((r) => [r.url, r.id]));
}

/**
 * The link set is the same for every recipient of a campaign, so a dispatch
 * batch resolves it once instead of re-interning every URL per subscriber.
 * Hrefs holding a merge field are skipped -- their final value differs per
 * recipient, so renderCampaignEmail resolves those on demand.
 */
export async function precomputeLinkIds(
  db: DB,
  campaign: Campaign,
  template: Template | null,
): Promise<Map<string, number>> {
  if (!campaign.track_clicks || campaign.content_type === "plain") return new Map();
  const body = template ? template.body.replace("{{ Body }}", campaign.body) : campaign.body;
  return resolveLinkIds(
    db,
    extractLinks(body).filter((url) => !url.includes("{{")),
  );
}

/**
 * Renders a campaign's body for one subscriber: merge fields, click-tracked
 * links (registered in `links` for later resolution), an open pixel, and the
 * text/plain alternative part.
 *
 * `linkIds` is an optional pre-resolved url -> link id map from
 * precomputeLinkIds; anything missing from it is resolved here.
 */
export async function renderCampaignEmail(
  db: DB,
  config: Config,
  campaign: Campaign,
  template: Template | null,
  subscriber: Subscriber,
  linkIds?: Map<string, number>,
): Promise<RenderedEmail> {
  const ref = unsubscribeRef("campaign", campaign.id);
  const unsubUrl = unsubscribeOneClickUrl(config, ref, subscriber.id);
  const unsubPageUrl = unsubscribePageUrl(config, ref, subscriber.id);
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
    // The visible link a subscriber clicks goes to the preference page, not
    // straight to the one-click API endpoint used for the List-Unsubscribe
    // header (`unsubUrl`, returned separately below).
    UnsubscribeURL: unsubPageUrl,
  };

  const body = template ? template.body.replace("{{ Body }}", campaign.body) : campaign.body;

  // Plain-text campaigns skip HTML-specific processing entirely -- no open
  // pixel, no link-tracking rewrite (there's nothing resembling <a href> to
  // find anyway), and merge fields are substituted directly against the
  // literal text. The result is sent as a genuine text/plain message with no
  // HTML part at all.
  if (campaign.content_type === "plain") {
    // The hidden-div technique is HTML-only -- a plain-text email has no
    // markup to hide anything in, and clients already show a snippet of the
    // real first line for these, so preheader is silently skipped rather
    // than surfaced as an error.
    return {
      subject: renderTemplate(campaign.subject, context),
      preheader: "",
      html: "",
      text: renderTemplate(body, context),
      unsubscribeUrl: unsubUrl,
    };
  }

  const preheader = campaign.preheader ? renderTemplate(campaign.preheader, context) : "";
  let html = renderTemplate(body, context);

  if (campaign.track_clicks) {
    // The unsubscribe link must never be wrapped in click-tracking below, or
    // clicking it would log a spurious "link click" (and could even fire a
    // link_clicked automation trigger) before redirecting.
    const links = extractLinks(html).filter((url) => url !== unsubPageUrl);
    const known = linkIds ?? new Map<string, number>();
    const missing = links.filter((url) => !known.has(url));
    const resolved = missing.length > 0 ? await resolveLinkIds(db, missing) : null;
    html = rewriteLinks(html, (url) => {
      if (url === unsubPageUrl) return undefined;
      const linkId = known.get(url) ?? resolved?.get(url);
      return linkId === undefined
        ? undefined
        : clickUrl(config, { campaignId: campaign.id, subscriberId: subscriber.id, linkId });
    });
  }

  // Derived from the link-rewritten HTML but before the preheader and pixel go
  // in: the text part should carry the same destinations a recipient would
  // click, and none of the markup that only exists to be invisible.
  const text = campaign.alt_body ? renderTemplate(campaign.alt_body, context) : htmlToText(html);

  html = injectPreheader(html, preheader);
  if (campaign.track_opens) {
    html = appendOpenPixel(
      html,
      openPixelUrl(config, { campaignId: campaign.id, subscriberId: subscriber.id }),
    );
  }

  return {
    subject: renderTemplate(campaign.subject, context),
    preheader,
    html,
    text,
    unsubscribeUrl: unsubUrl,
  };
}

/** A plain-text campaign has no HTML part, but the preview pane still needs
 * something to render. */
export function plainTextPreviewHtml(text: string): string {
  return `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(text)}</pre>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
