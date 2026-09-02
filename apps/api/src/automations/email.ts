import { z } from "zod";
import type { DB } from "../db/kysely.js";
import type { Config } from "../config.js";
import { appendOpenPixel, extractLinks, renderTemplate, rewriteLinks } from "../lib/template.js";
import { markdownToHtml } from "../lib/markdown.js";
import { htmlToText } from "../lib/htmlToText.js";
import {
  automationClickUrl,
  automationOpenPixelUrl,
  unsubscribeOneClickUrl,
  unsubscribePageUrl,
  unsubscribeRef,
} from "../lib/trackingUrls.js";
import { resolveLinkIds } from "../services/mailer.js";
import type { Automation, Subscriber } from "./types.js";

/** Just the fields that decide what the email *says* -- everything
 * renderAutomationEmail needs, and nothing about how it is delivered. Split
 * out so previewing works on a node that has no connection picked yet. */
export const SendCustomEmailContent = z.object({
  subject: z.string().min(1),
  // Same model as campaigns: `body` holds the source for its content type
  // and is converted at send time (see jobs/campaignDispatch.ts).
  body: z.string().min(1),
  body_source: z.string().nullable().optional(),
  content_type: z.enum(["richtext", "html", "markdown", "plain"]).default("richtext"),
  /** Optional wrapper, same `{{ Body }}` slot campaigns use. Null/absent
   * sends the body unwrapped -- the behaviour every automation had before
   * this existed, so adding the field can't change what an already-published
   * automation puts on the wire. */
  template_id: z.number().int().nullish(),
  /** Default false, not true: turning these on for nodes that predate the
   * feature would start rewriting links and adding a pixel to what an already
   * published automation puts on the wire. The builder sets both true on a
   * *new* node instead, so the expected default applies where it is safe. */
  track_opens: z.boolean().default(false),
  track_clicks: z.boolean().default(false),
});

export const SendCustomEmailConfig = SendCustomEmailContent.extend({
  /** Both optional, both overriding the sending connection's own values for
   * this step only -- the same pair campaigns carry. `from_name` is valid on
   * its own (the connection's address is still used), which is why there is no
   * from_email here: changing the address breaks SPF/DKIM alignment with the
   * connection unless the domain is set up for it, and that is a
   * connection-level decision rather than a per-step one. */
  from_name: z.string().nullish(),
  reply_to: z.string().email().nullish(),
  /** Required, and explicit: there is deliberately no implicit "any enabled
   * connection" fallback (see services/connections.ts), so a node without one
   * could be published and would then silently drop every email it tried to
   * send. Publishing is refused instead. */
  connection_id: z.number().int(),
  fallback_connection_ids: z.array(z.number().int()).default([]),
});

/** Preview runs while the step is still being written, so unlike a send it
 * accepts an empty subject or body rather than refusing to render. */
export const SendCustomEmailPreview = SendCustomEmailContent.extend({
  subject: z.string().default(""),
  body: z.string().default(""),
});

export type SendCustomEmailContentSettings = z.infer<typeof SendCustomEmailContent>;
export type SendCustomEmailSettings = z.infer<typeof SendCustomEmailConfig>;

/** Automation emails aren't campaign-scoped, so their unsubscribe links are
 * signed against the automation's uuid instead. The visible link reuses the
 * existing preference page (which only needs a valid signature and the
 * contact); the one-click List-Unsubscribe target gets its own endpoint in
 * routes/tracking.ts since there are no campaign lists to leave. */
export function unsubscribeUrls(
  config: Config,
  automation: Automation,
  subscriber: Subscriber,
  emailNodeId?: number | null,
) {
  // Signed against the email node when the caller has one (a real send), so
  // the departure is attributable to the exact step. A preview or test send
  // has no node ref and falls back to the automation.
  const ref = emailNodeId
    ? unsubscribeRef("automation_node", emailNodeId)
    : unsubscribeRef("automation", automation.id);
  return {
    oneClick: unsubscribeOneClickUrl(config, ref, subscriber.id),
    page: unsubscribePageUrl(config, ref, subscriber.id),
  };
}

export interface RenderedAutomationEmail {
  subject: string;
  html: string;
  text: string;
  /** The one-click List-Unsubscribe target, not the visible link. */
  unsubscribeUrl: string;
}

/**
 * Renders one automation email for one contact. Shared by the
 * `send_custom_email` action, the test-send endpoint and the preview, so what
 * a test puts in your inbox is what the live automation will send.
 *
 * `tracking` is what separates them: only a real send passes it, so a test or
 * a preview never carries a pixel or rewritten links. Otherwise the author
 * previewing their own draft would register as an open against the node, and
 * every test send would inflate its stats.
 */
export async function renderAutomationEmail(
  db: DB,
  config: Config,
  automation: Automation,
  subscriber: Subscriber,
  settings: SendCustomEmailContentSettings,
  tracking?: { emailNodeId: number } | null,
): Promise<RenderedAutomationEmail> {
  const unsub = unsubscribeUrls(config, automation, subscriber, tracking?.emailNodeId);
  const context = {
    Subscriber: {
      ID: subscriber.id,
      UUID: subscriber.uuid,
      Email: subscriber.email,
      Name: subscriber.name,
      Attribs: subscriber.attribs,
      Tags: subscriber.tags,
    },
    Automation: { ID: automation.id, UUID: automation.uuid, Name: automation.name },
    UnsubscribeURL: unsub.page,
  };

  // A plain-text automation email is sent as a genuine text/plain message
  // with no HTML part; an HTML one always carries a text alternative, since
  // HTML-only is a standing SpamAssassin penalty.
  let html = "";
  let text: string;
  if (settings.content_type === "plain") {
    // No wrapper for plain text -- a template body is HTML, exactly as
    // renderCampaignEmail treats a plain-text campaign.
    text = renderTemplate(settings.body, context);
  } else {
    const source =
      settings.content_type === "markdown" ? markdownToHtml(settings.body) : settings.body;
    // Wrap first, render second, so merge fields inside the template body
    // resolve too -- the same order as services/mailer.ts. A template_id
    // pointing at a since-deleted template falls back to the bare body
    // rather than stranding the contact on this node.
    const template = settings.template_id
      ? ((await db
          .selectFrom("templates")
          .select("body")
          .where("id", "=", settings.template_id)
          .executeTakeFirst()) ?? null)
      : null;
    const wrapped = template ? template.body.replace("{{ Body }}", source) : source;
    html = renderTemplate(wrapped, context);

    if (tracking && settings.track_clicks) {
      // The unsubscribe link must never be wrapped in click-tracking, or
      // clicking it would log a spurious click (and could fire a link_clicked
      // trigger) before redirecting -- same carve-out as renderCampaignEmail.
      const urls = extractLinks(html).filter((url) => url !== unsub.page);
      const linkIds = urls.length > 0 ? await resolveLinkIds(db, urls) : new Map<string, number>();
      html = rewriteLinks(html, (url) => {
        if (url === unsub.page) return undefined;
        const linkId = linkIds.get(url);
        return linkId === undefined
          ? undefined
          : automationClickUrl(config, {
              emailNodeId: tracking.emailNodeId,
              subscriberId: subscriber.id,
              linkId,
            });
      });
    }

    // Derived from the link-rewritten HTML but before the pixel goes in: the
    // text part should carry the same destinations a recipient would click,
    // and none of the markup that only exists to be invisible.
    text = htmlToText(html);

    if (tracking && settings.track_opens) {
      html = appendOpenPixel(
        html,
        automationOpenPixelUrl(config, {
          emailNodeId: tracking.emailNodeId,
          subscriberId: subscriber.id,
        }),
      );
    }
  }

  return {
    subject: renderTemplate(settings.subject, context),
    html,
    text,
    unsubscribeUrl: unsub.oneClick,
  };
}

/**
 * The automation_email_nodes row for one (automation, node) pair, created on
 * first use. Upsert rather than select-then-insert so two workers sending the
 * same node concurrently can't race a duplicate past the unique index.
 */
export async function resolveEmailNodeId(
  db: DB,
  automationId: number,
  nodeId: string,
): Promise<number> {
  const row = await db
    .insertInto("automation_email_nodes")
    .values({ automation_id: automationId, node_id: nodeId })
    // A no-op update rather than doNothing: RETURNING skips the rows a
    // doNothing conflict discards, and an existing pair's id is exactly what
    // this needs back.
    .onConflict((oc) =>
      oc.columns(["automation_id", "node_id"]).doUpdateSet((eb) => ({
        node_id: eb.ref("excluded.node_id"),
      })),
    )
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Logged for every email a node actually hands to a connection -- the
 * denominator its open and click rates are computed against. Recorded even
 * when both tracking toggles are off, so turning them on later still has a
 * "sent" figure to sit beside. */
export async function recordEmailSend(
  db: DB,
  emailNodeId: number,
  subscriberId: number,
): Promise<void> {
  try {
    await db
      .insertInto("automation_email_sends")
      .values({ email_node_id: emailNodeId, subscriber_id: subscriberId })
      .execute();
  } catch (err) {
    // Telemetry must never fail a send that already went out.
    console.error(`automation send logging failed for node ${emailNodeId}: ${String(err)}`);
  }
}
