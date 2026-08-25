import { z } from "zod";
import { nanoid } from "nanoid";
import { defineTrigger, type RegisteredTrigger } from "./types.js";

/** At least one list is required. An automation that fires on *any* list is
 * almost never what the author meant, and the failure mode (mailing everyone
 * who joins anything) is far worse than the alternative -- so an empty
 * selection fails to parse, which blocks publishing and stops this trigger
 * matching anything. The builder flags it on the block before that point. */
const ListConfig = z.object({ list_ids: z.array(z.number().int()).min(1) });

function listMatches(config: z.infer<typeof ListConfig>, listId: unknown): boolean {
  if (typeof listId !== "number") return false;
  return config.list_ids.includes(listId);
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
