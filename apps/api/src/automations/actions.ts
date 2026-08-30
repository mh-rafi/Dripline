import { z } from "zod";
import { defineAction, type RegisteredAction } from "./types.js";
import { addToList, removeFromList } from "../services/subscribers.js";
import { getExplicitConnectionChain, sendWithChain } from "../services/connections.js";
import { renderTemplate } from "../lib/template.js";
import { markdownToHtml } from "../lib/markdown.js";
import { htmlToText } from "../lib/htmlToText.js";
import { unsubscribeOneClickUrl, unsubscribePageUrl, unsubscribeRef } from "../lib/trackingUrls.js";
import type { Automation, Subscriber } from "./types.js";
import type { Config } from "../config.js";

const UNIT_SECONDS = { minutes: 60, hours: 3600, days: 86400 } as const;

const wait = defineAction({
  type: "wait",
  label: "Wait X days/hours",
  description: "Hold the contact here for a set amount of time before continuing.",
  group: "timing",
  configSchema: z.object({
    unit: z.enum(["minutes", "hours", "days"]).default("days"),
    amount: z.number().int().positive().default(1),
  }),
  // A wait doesn't park the contact *on* this node -- it moves them onto the
  // next one with next_run_at in the future, so editing the wait later never
  // strands anyone mid-delay.
  execute: async ({ settings }) => ({
    kind: "advance",
    delayUntil: new Date(Date.now() + settings.amount * UNIT_SECONDS[settings.unit] * 1000),
  }),
});

const ListsConfig = z.object({ list_ids: z.array(z.number().int()).min(1) });

const applyList = defineAction({
  type: "apply_list",
  label: "Apply list",
  description: "Add the contact to one or more lists.",
  group: "contact",
  configSchema: ListsConfig.extend({
    status: z.enum(["unconfirmed", "confirmed"]).optional(),
  }),
  execute: async ({ db, subscriber, settings }) => {
    for (const listId of settings.list_ids) {
      // No status forced by default: an automation must not be able to bypass
      // double opt-in consent -- addToList picks the right default per list.
      await addToList(db, subscriber.id, listId, settings.status);
    }
    return { kind: "advance" };
  },
});

const removeList = defineAction({
  type: "remove_list",
  label: "Remove list",
  description: "Remove the contact from one or more lists.",
  group: "contact",
  configSchema: ListsConfig,
  execute: async ({ db, subscriber, settings }) => {
    for (const listId of settings.list_ids) {
      await removeFromList(db, subscriber.id, listId);
    }
    return { kind: "advance" };
  },
});

/** Automation emails aren't campaign-scoped, so their unsubscribe links are
 * signed against the automation's uuid instead. The visible link reuses the
 * existing preference page (which only needs a valid signature and the
 * contact); the one-click List-Unsubscribe target gets its own endpoint in
 * routes/tracking.ts since there are no campaign lists to leave. */
function unsubscribeUrls(config: Config, automation: Automation, subscriber: Subscriber) {
  const ref = unsubscribeRef("automation", automation.id);
  return {
    oneClick: unsubscribeOneClickUrl(config, ref, subscriber.id),
    page: unsubscribePageUrl(config, ref, subscriber.id),
  };
}

const sendCustomEmail = defineAction({
  type: "send_custom_email",
  label: "Send custom email",
  description: "Write and send a one-off email to the contact from this automation.",
  group: "email",
  configSchema: z.object({
    subject: z.string().min(1),
    // Same model as campaigns: `body` holds the source for its content type
    // and is converted at send time (see jobs/campaignDispatch.ts).
    body: z.string().min(1),
    body_source: z.string().nullable().optional(),
    content_type: z.enum(["richtext", "html", "markdown", "plain"]).default("richtext"),
    /** Required, and explicit: there is deliberately no implicit "any enabled
     * connection" fallback (see services/connections.ts), so a node without one
     * could be published and would then silently drop every email it tried to
     * send. Publishing is refused instead. */
    connection_id: z.number().int(),
    fallback_connection_ids: z.array(z.number().int()).default([]),
  }),
  execute: async ({ db, config, automation, subscriber, settings }) => {
    const unsub = unsubscribeUrls(config, automation, subscriber);
    const context = {
      Subscriber: {
        ID: subscriber.id,
        UUID: subscriber.uuid,
        Email: subscriber.email,
        Name: subscriber.name,
        Attribs: subscriber.attribs,
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
      text = renderTemplate(settings.body, context);
    } else {
      const source =
        settings.content_type === "markdown" ? markdownToHtml(settings.body) : settings.body;
      html = renderTemplate(source, context);
      text = htmlToText(html);
    }

    const chain = await getExplicitConnectionChain(
      db,
      settings.connection_id,
      settings.fallback_connection_ids,
    );
    const result = await sendWithChain(db, chain, {
      to: subscriber.email,
      subject: renderTemplate(settings.subject, context),
      html,
      text,
      unsubscribeUrl: unsub.oneClick,
    });

    if (!result.ok && result.error === "rate_limited") {
      // Not a failure -- come back to this same node shortly rather than
      // silently dropping the email and moving on.
      return { kind: "retry", delayUntil: new Date(Date.now() + 60_000) };
    }
    if (!result.ok) {
      console.error(
        `automation ${automation.id}: send_custom_email failed for subscriber ${subscriber.id}: ${result.error}`,
      );
    }
    return { kind: "advance" };
  },
});

export const ACTIONS: RegisteredAction[] = [wait, sendCustomEmail, applyList, removeList];

const BY_TYPE = new Map(ACTIONS.map((a) => [a.type, a]));

export function getAction(type: string): RegisteredAction | undefined {
  return BY_TYPE.get(type);
}
