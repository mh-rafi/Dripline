import { sql } from "kysely";
import type { DB } from "../db/kysely.js";
import type { Config } from "../config.js";
import { NotFoundError } from "../lib/errors.js";
import { WorkflowSteps, evaluateCondition } from "../lib/workflowSteps.js";
import { renderTemplate } from "../lib/template.js";
import { getWorkflowConnectionChain, sendWithChain } from "./connections.js";

export async function getWorkflowOrThrow(db: DB, id: number) {
  const workflow = await db
    .selectFrom("workflows")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!workflow) throw new NotFoundError("workflow");
  return workflow;
}

/** Enrolls a subscriber into a workflow, respecting the active-enrollment uniqueness
 * constraint and reentry_allowed. Silently no-ops if already actively enrolled. */
export async function enroll(db: DB, workflowId: number, subscriberId: number): Promise<void> {
  const workflow = await db
    .selectFrom("workflows")
    .selectAll()
    .where("id", "=", workflowId)
    .executeTakeFirst();
  if (!workflow || workflow.status !== "active") return;

  if (!workflow.reentry_allowed) {
    const previouslyCompleted = await db
      .selectFrom("workflow_enrollments")
      .select("id")
      .where("workflow_id", "=", workflowId)
      .where("subscriber_id", "=", subscriberId)
      .where("status", "!=", "active")
      .executeTakeFirst();
    if (previouslyCompleted) return;
  }

  await db
    .insertInto("workflow_enrollments")
    .values({
      workflow_id: workflowId,
      subscriber_id: subscriberId,
      status: "active",
      current_step: 0,
      next_run_at: new Date(),
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
}

export async function triggerListJoined(
  db: DB,
  subscriberId: number,
  listId: number,
): Promise<void> {
  const workflows = await db
    .selectFrom("workflows")
    .select("id")
    .where("status", "=", "active")
    .where("trigger_type", "=", "list_joined")
    .where(sql<boolean>`trigger_config->>'list_id' = ${String(listId)}`)
    .execute();
  for (const w of workflows) await enroll(db, w.id, subscriberId);
}

export async function triggerTagApplied(db: DB, subscriberId: number, tag: string): Promise<void> {
  const workflows = await db
    .selectFrom("workflows")
    .select("id")
    .where("status", "=", "active")
    .where("trigger_type", "=", "tag_applied")
    .where(sql<boolean>`trigger_config->>'tag' = ${tag}`)
    .execute();
  for (const w of workflows) await enroll(db, w.id, subscriberId);
}

export interface RecordEventInput {
  source: string;
  eventKey: string;
  subscriberId: number | null;
  payload: Record<string, unknown>;
}

export async function recordEvent(db: DB, input: RecordEventInput): Promise<void> {
  await db
    .insertInto("workflow_events")
    .values({
      source: input.source,
      event_key: input.eventKey,
      subscriber_id: input.subscriberId,
      payload: input.payload,
    })
    .execute();
}

/** Matches unprocessed webhook/link_clicked events against active workflows and enrolls. */
export async function processEventsScan(db: DB): Promise<void> {
  const events = await db
    .selectFrom("workflow_events")
    .selectAll()
    .where("processed", "=", false)
    .orderBy("id")
    .limit(500)
    .execute();

  for (const event of events) {
    if (event.subscriber_id !== null) {
      const workflows = await db
        .selectFrom("workflows")
        .select("id")
        .where("status", "=", "active")
        .where("trigger_type", "in", ["webhook", "link_clicked"])
        .where(sql<boolean>`trigger_config->>'event_key' = ${event.event_key}`)
        .execute();
      for (const w of workflows) await enroll(db, w.id, event.subscriber_id);
    }

    await db
      .updateTable("workflow_events")
      .set({ processed: true })
      .where("id", "=", event.id)
      .execute();
  }
}

/** Executes exactly one step for one enrollment, then persists the resulting
 * position (current_step + next_run_at). Delay steps push next_run_at into the
 * future; everything else is immediately due again so the next scan tick
 * continues the sequence. Processing one step per invocation keeps each
 * transition durable and avoids unbounded work inside a single job. */
export async function processEnrollmentStep(
  db: DB,
  config: Config,
  enrollmentId: string,
): Promise<void> {
  const enrollment = await db
    .selectFrom("workflow_enrollments")
    .selectAll()
    .where("id", "=", enrollmentId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!enrollment) return;

  const workflow = await db
    .selectFrom("workflows")
    .selectAll()
    .where("id", "=", enrollment.workflow_id)
    .executeTakeFirst();
  if (!workflow || workflow.status !== "active") return;

  const steps = WorkflowSteps.parse(workflow.steps);
  const step = steps[enrollment.current_step];

  if (!step) {
    await db
      .updateTable("workflow_enrollments")
      .set({ status: "completed", next_run_at: null })
      .where("id", "=", enrollmentId)
      .execute();
    return;
  }

  const subscriber = await db
    .selectFrom("subscribers")
    .selectAll()
    .where("id", "=", enrollment.subscriber_id)
    .executeTakeFirst();
  if (!subscriber || subscriber.status === "blocklisted") {
    await db
      .updateTable("workflow_enrollments")
      .set({ status: "cancelled", next_run_at: null })
      .where("id", "=", enrollmentId)
      .execute();
    return;
  }

  let nextStep = enrollment.current_step + 1;
  let nextRunAt: Date | null = new Date();

  switch (step.type) {
    case "delay": {
      nextRunAt = new Date(Date.now() + step.duration_seconds * 1000);
      break;
    }
    case "send_email": {
      const context = {
        Subscriber: {
          ID: subscriber.id,
          UUID: subscriber.uuid,
          Email: subscriber.email,
          Name: subscriber.name,
          Attribs: subscriber.attribs,
        },
        Campaign: { ID: 0, UUID: workflow.uuid, Name: workflow.name, Subject: step.subject },
        UnsubscribeURL: `${config.appUrl}/api/v1/workflows/${workflow.id}/unsubscribe/${subscriber.uuid}`,
      };
      const chain = await getWorkflowConnectionChain(
        db,
        step.connection_id,
        step.fallback_connection_ids,
      );
      const result = await sendWithChain(db, chain, {
        to: subscriber.email,
        subject: renderTemplate(step.subject, context),
        html: renderTemplate(step.body, context),
        unsubscribeUrl: context.UnsubscribeURL,
      });
      if (!result.ok && result.error === "rate_limited") {
        // Not a failure -- retry this same step next tick instead of silently
        // dropping the email and moving on.
        nextStep = enrollment.current_step;
        break;
      }
      if (!result.ok) {
        console.error(
          `workflow ${workflow.id} enrollment ${enrollmentId}: send_email step failed: ${result.error}`,
        );
      }
      break;
    }
    case "add_tag": {
      const { addTag } = await import("./subscribers.js");
      await addTag(db, subscriber.id, step.tag);
      break;
    }
    case "remove_tag": {
      const { removeTag } = await import("./subscribers.js");
      await removeTag(db, subscriber.id, step.tag);
      break;
    }
    case "add_list": {
      // No explicit status forced -- a workflow shouldn't be able to bypass
      // double opt-in consent by auto-confirming; addToList defaults
      // correctly per the list's opt-in type.
      const { addToList } = await import("./subscribers.js");
      await addToList(db, subscriber.id, step.list_id);
      break;
    }
    case "remove_list": {
      const { removeFromList } = await import("./subscribers.js");
      await removeFromList(db, subscriber.id, step.list_id);
      break;
    }
    case "condition": {
      const passed = evaluateCondition(step, subscriber.attribs);
      if (!passed) {
        nextStep = step.else_jump ?? steps.length;
      }
      break;
    }
    case "webhook_out": {
      try {
        await fetch(step.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            subscriber: { email: subscriber.email, id: subscriber.id },
            ...step.payload,
          }),
        });
      } catch {
        // Best-effort; a failed outbound webhook does not block the workflow.
      }
      break;
    }
  }

  await db
    .updateTable("workflow_enrollments")
    .set({ current_step: nextStep, next_run_at: nextRunAt })
    .where("id", "=", enrollmentId)
    .execute();
}
