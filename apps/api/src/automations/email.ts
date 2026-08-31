import { z } from "zod";
import type { DB } from "../db/kysely.js";
import type { Config } from "../config.js";
import { renderTemplate } from "../lib/template.js";
import { markdownToHtml } from "../lib/markdown.js";
import { htmlToText } from "../lib/htmlToText.js";
import { unsubscribeOneClickUrl, unsubscribePageUrl, unsubscribeRef } from "../lib/trackingUrls.js";
import type { Automation, Subscriber } from "./types.js";

export const SendCustomEmailConfig = z.object({
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
  /** Required, and explicit: there is deliberately no implicit "any enabled
   * connection" fallback (see services/connections.ts), so a node without one
   * could be published and would then silently drop every email it tried to
   * send. Publishing is refused instead. */
  connection_id: z.number().int(),
  fallback_connection_ids: z.array(z.number().int()).default([]),
});

export type SendCustomEmailSettings = z.infer<typeof SendCustomEmailConfig>;

/** Automation emails aren't campaign-scoped, so their unsubscribe links are
 * signed against the automation's uuid instead. The visible link reuses the
 * existing preference page (which only needs a valid signature and the
 * contact); the one-click List-Unsubscribe target gets its own endpoint in
 * routes/tracking.ts since there are no campaign lists to leave. */
export function unsubscribeUrls(config: Config, automation: Automation, subscriber: Subscriber) {
  const ref = unsubscribeRef("automation", automation.id);
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
 * `send_custom_email` action and the test-send endpoint, so what a test puts
 * in your inbox is byte-for-byte what the live automation will send.
 */
export async function renderAutomationEmail(
  db: DB,
  config: Config,
  automation: Automation,
  subscriber: Subscriber,
  settings: SendCustomEmailSettings,
): Promise<RenderedAutomationEmail> {
  const unsub = unsubscribeUrls(config, automation, subscriber);
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
    text = htmlToText(html);
  }

  return {
    subject: renderTemplate(settings.subject, context),
    html,
    text,
    unsubscribeUrl: unsub.oneClick,
  };
}
