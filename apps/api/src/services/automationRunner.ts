import type { DB } from "../db/kysely.js";
import type { Config } from "../config.js";
import { AutomationGraph, findNode } from "../lib/automationGraph.js";
import { getAction } from "../automations/actions.js";
import type { ActionResult } from "../automations/types.js";

async function finish(
  db: DB,
  enrollmentId: string,
  status: "completed" | "cancelled",
): Promise<void> {
  await db
    .updateTable("automation_enrollments")
    .set({ status, next_run_at: null, completed_at: new Date() })
    .where("id", "=", enrollmentId)
    .execute();
}

/**
 * Executes exactly one node for one enrollment, then persists the resulting
 * position. One node per invocation keeps every transition durable and bounds
 * the work inside a single job -- a `wait` node's delay is expressed as a
 * future `next_run_at` on the *following* node, so nothing sits in memory
 * across a restart.
 */
export async function processEnrollmentStep(
  db: DB,
  config: Config,
  enrollmentId: string,
): Promise<void> {
  const enrollment = await db
    .selectFrom("automation_enrollments")
    .selectAll()
    .where("id", "=", enrollmentId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!enrollment) return;

  const automation = await db
    .selectFrom("automations")
    .selectAll()
    .where("id", "=", enrollment.automation_id)
    .executeTakeFirst();
  // A paused automation holds its contacts in place rather than dropping them:
  // they resume from the same node when it is published again.
  if (!automation || automation.status !== "published") return;

  const graph = AutomationGraph.parse(automation.graph);
  const node = findNode(graph, enrollment.current_node_id);
  // Either the run reached the end of a path, or the node was deleted while
  // the contact was sitting on it. Both mean "done".
  if (!node) return finish(db, enrollmentId, "completed");

  const subscriber = await db
    .selectFrom("subscribers")
    .selectAll()
    .where("id", "=", enrollment.subscriber_id)
    .executeTakeFirst();
  if (!subscriber || subscriber.status === "blocklisted") {
    return finish(db, enrollmentId, "cancelled");
  }

  const action = getAction(node.type);
  if (!action) {
    console.error(`automation ${automation.id}: unknown action type "${node.type}", skipping node`);
    await db
      .updateTable("automation_enrollments")
      .set({ current_node_id: node.next, next_run_at: new Date() })
      .where("id", "=", enrollmentId)
      .execute();
    return;
  }

  // Logged before the action runs, so a node that throws still counts as
  // reached and the drop-off shows up at the *next* step rather than this one.
  // ON CONFLICT DO NOTHING against the (enrollment, node) unique index: a
  // `retry` comes back here and must not count the contact twice.
  await db
    .insertInto("automation_node_runs")
    .values({
      automation_id: automation.id,
      node_id: node.id,
      enrollment_id: enrollment.id,
      subscriber_id: subscriber.id,
    })
    .onConflict((oc) => oc.columns(["enrollment_id", "node_id"]).doNothing())
    .execute();

  let result: ActionResult;
  try {
    result = await action.execute({
      db,
      config,
      automation,
      enrollment,
      subscriber,
      node,
    });
  } catch (err) {
    // A misconfigured node (invalid config, a failing integration) must not
    // trap the contact on it forever -- log and move the run along.
    console.error(
      `automation ${automation.id}: node ${node.id} (${node.type}) failed, advancing`,
      err,
    );
    result = { kind: "advance" };
  }

  if (result.kind === "stop") return finish(db, enrollmentId, result.status);

  const nextNodeId =
    result.kind === "goto" ? result.nodeId : result.kind === "retry" ? node.id : node.next;

  if (!nextNodeId) return finish(db, enrollmentId, "completed");

  await db
    .updateTable("automation_enrollments")
    .set({ current_node_id: nextNodeId, next_run_at: result.delayUntil ?? new Date() })
    .where("id", "=", enrollmentId)
    .execute();
}
