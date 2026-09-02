import { z } from "zod";
import { defineAction, type RegisteredAction } from "./types.js";
import { addToList, removeFromList } from "../services/subscribers.js";
import { getExplicitConnectionChain, sendWithChain } from "../services/connections.js";
import {
  SendCustomEmailConfig,
  recordEmailSend,
  renderAutomationEmail,
  resolveEmailNodeId,
} from "./email.js";

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

const sendCustomEmail = defineAction({
  type: "send_custom_email",
  label: "Send custom email",
  description: "Write and send a one-off email to the contact from this automation.",
  group: "email",
  configSchema: SendCustomEmailConfig,
  execute: async ({ db, config, automation, node, subscriber, settings }) => {
    const emailNodeId = await resolveEmailNodeId(db, automation.id, node.id);
    const rendered = await renderAutomationEmail(db, config, automation, subscriber, settings, {
      emailNodeId,
    });

    const chain = await getExplicitConnectionChain(
      db,
      settings.connection_id,
      settings.fallback_connection_ids,
    );
    const result = await sendWithChain(db, chain, {
      to: subscriber.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      unsubscribeUrl: rendered.unsubscribeUrl,
    });

    if (result.ok) await recordEmailSend(db, emailNodeId, subscriber.id);

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
