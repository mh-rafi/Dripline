import { z } from "zod";
import { nanoid } from "nanoid";
import { defineTrigger, type RegisteredTrigger } from "./types.js";

/** Empty `list_ids` deliberately means "any list" -- the create dialog offers a
 * trigger before the author has picked lists, and an unconfigured trigger that
 * fires broadly is easier to notice (and fix) than one that silently never
 * fires. */
const ListConfig = z.object({ list_ids: z.array(z.number().int()).default([]) });

function listMatches(config: z.infer<typeof ListConfig>, listId: unknown): boolean {
  if (typeof listId !== "number") return false;
  return config.list_ids.length === 0 || config.list_ids.includes(listId);
}

const listApplied = defineTrigger({
  type: "list_applied",
  label: "List applied",
  description: "Runs when a contact is added to one of the selected lists.",
  group: "Contact",
  configSchema: ListConfig,
  matches: (config, event) => listMatches(config, event.data.listId),
});

const listRemoved = defineTrigger({
  type: "list_removed",
  label: "List removed",
  description: "Runs when a contact is removed from one of the selected lists.",
  group: "Contact",
  configSchema: ListConfig,
  matches: (config, event) => listMatches(config, event.data.listId),
});

const contactCreated = defineTrigger({
  type: "contact_created",
  label: "Contact created",
  description: "Runs once for every new contact added to Dripline, however they were added.",
  group: "Contact",
  configSchema: z.object({}),
  matches: () => true,
});

const webhookIncoming = defineTrigger({
  type: "webhook_incoming",
  label: "Incoming webhook",
  description:
    "Runs when your own app, form or CRM posts a contact to this automation's private webhook URL.",
  group: "Integration",
  configSchema: z.object({ key: z.string().min(1) }),
  // The key doubles as the endpoint's secret, so it is generated server-side
  // at creation rather than typed by the author.
  createDefaults: () => ({ key: nanoid(32) }),
  matches: (config, event) => config.key === event.data.key,
});

export const TRIGGERS: RegisteredTrigger[] = [
  listApplied,
  listRemoved,
  contactCreated,
  webhookIncoming,
];

const BY_TYPE = new Map(TRIGGERS.map((t) => [t.type, t]));

export function getTrigger(type: string): RegisteredTrigger | undefined {
  return BY_TYPE.get(type);
}

export const TRIGGER_TYPES = TRIGGERS.map((t) => t.type);
