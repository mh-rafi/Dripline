import type { DB } from "../db/kysely.js";
import { NotFoundError } from "../lib/errors.js";
import { AutomationGraph } from "../lib/automationGraph.js";
import { getTrigger } from "../automations/triggers.js";
import type { AutomationEvent } from "../automations/types.js";

export async function getAutomationOrThrow(db: DB, id: number) {
  const automation = await db
    .selectFrom("automations")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!automation) throw new NotFoundError("automation");
  return automation;
}

/**
 * Enrols a contact, respecting the active-enrollment uniqueness constraint and
 * `reentry_mode`. A no-op (rather than an error) when the contact is already
 * enrolled, the automation isn't published, or re-entry is disallowed and they
 * have been through before -- callers are event handlers, not user actions.
 */
export async function enroll(db: DB, automationId: number, subscriberId: number): Promise<void> {
  const automation = await db
    .selectFrom("automations")
    .select(["id", "status", "reentry_mode", "graph"])
    .where("id", "=", automationId)
    .executeTakeFirst();
  if (!automation || automation.status !== "published") return;

  const graph = AutomationGraph.parse(automation.graph);
  // Nothing to run: an automation that is only a trigger would otherwise
  // collect enrollments that complete on their first tick.
  if (!graph.entry) return;

  if (automation.reentry_mode === "once") {
    const previous = await db
      .selectFrom("automation_enrollments")
      .select("id")
      .where("automation_id", "=", automationId)
      .where("subscriber_id", "=", subscriberId)
      .where("status", "!=", "active")
      .executeTakeFirst();
    if (previous) return;
  }

  const subscriber = await db
    .selectFrom("subscribers")
    .select("status")
    .where("id", "=", subscriberId)
    .executeTakeFirst();
  if (!subscriber || subscriber.status === "blocklisted") return;

  await db
    .insertInto("automation_enrollments")
    .values({
      automation_id: automationId,
      subscriber_id: subscriberId,
      status: "active",
      current_node_id: graph.entry,
      next_run_at: new Date(),
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
}

/**
 * The single funnel every trigger source goes through. Offers the event to
 * each published automation listening for that trigger type and enrols the
 * contact where the trigger's own `matches()` says it applies.
 *
 * Deliberately best-effort: automations must never break the mutation that
 * fired them (adding a contact to a list, importing a CSV, ...).
 */
export async function fireEvent(db: DB, event: AutomationEvent): Promise<void> {
  const trigger = getTrigger(event.type);
  if (!trigger) return;

  try {
    const automations = await db
      .selectFrom("automations")
      .select(["id", "trigger_config"])
      .where("status", "=", "published")
      .where("trigger_type", "=", event.type)
      .execute();

    for (const automation of automations) {
      if (!trigger.matches(automation.trigger_config, event)) continue;
      await enroll(db, automation.id, event.subscriberId);
    }
  } catch (err) {
    console.error(`automation event ${event.type} failed to dispatch`, err);
  }
}

export interface RecordEventInput {
  source: string;
  eventKey: string;
  subscriberId: number | null;
  payload: Record<string, unknown>;
}

/** Audit trail for asynchronous ingress (incoming webhooks, link clicks). */
export async function recordEvent(db: DB, input: RecordEventInput): Promise<void> {
  await db
    .insertInto("automation_events")
    .values({
      source: input.source,
      event_key: input.eventKey,
      subscriber_id: input.subscriberId,
      payload: input.payload,
    })
    .execute();
}
