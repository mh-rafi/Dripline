import type { DB } from "../db/kysely.js";
import { AutomationGraph, orderedNodes } from "../lib/automationGraph.js";
import { getAction } from "../automations/actions.js";
import { getAutomationEmailStats } from "./automationEmailStats.js";

export interface AutomationReportEmail {
  subject: string;
  sent: number;
  opens: number;
  unique_opens: number;
  clicks: number;
  unique_clicks: number;
  unsubscribes: number;
  links: { url: string; clicks: number; unique_clicks: number }[];
}

export interface AutomationReportStep {
  node_id: string;
  type: string;
  label: string;
  /** Contacts who reached this step, from automation_node_runs. */
  contacts: number;
  /** Share of everyone who ever entered. */
  pct: number;
  /** How much of the entering population never got this far. Measured against
   * the entrance, not the previous step -- the funnel reads as one descent. */
  drop_pct: number;
  email: AutomationReportEmail | null;
}

export interface AutomationReport {
  entered: number;
  enrollment_counts: { active: number; completed: number; cancelled: number };
  steps: AutomationReportStep[];
  /** Share of entrants who reached the final step. */
  conversion_pct: number;
}

function share(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

/**
 * The automation funnel: one row per graph node, in path order, with the
 * contacts who reached it and -- for email steps -- what they did with the
 * mail.
 *
 * Step counts come from automation_node_runs rather than from enrollments:
 * an enrollment only says where a contact is *now*, and a completed run says
 * nothing at all, so the position column can't reconstruct a funnel.
 */
export async function getAutomationReport(
  db: DB,
  automationId: number,
  graphJson: unknown,
): Promise<AutomationReport> {
  const graph = AutomationGraph.parse(graphJson);
  const nodes = orderedNodes(graph);

  const [statusRows, runRows, emailStats] = await Promise.all([
    db
      .selectFrom("automation_enrollments")
      .select(["status", db.fn.countAll().as("count")])
      .where("automation_id", "=", automationId)
      .groupBy("status")
      .execute(),
    db
      .selectFrom("automation_node_runs")
      .select(["node_id", db.fn.countAll().as("count")])
      .where("automation_id", "=", automationId)
      .groupBy("node_id")
      .execute(),
    getAutomationEmailStats(db, automationId),
  ]);

  const enrollment_counts = { active: 0, completed: 0, cancelled: 0 };
  for (const row of statusRows) {
    enrollment_counts[row.status] = Number(row.count);
  }
  const entered =
    enrollment_counts.active + enrollment_counts.completed + enrollment_counts.cancelled;

  const runsBy = new Map(runRows.map((r) => [r.node_id, Number(r.count)]));
  const emailBy = new Map(emailStats.map((s) => [s.node_id, s]));

  // Departures are attributed to the email node that carried the link, so a
  // per-step unsubscribe count is a plain group-by.
  const unsubRows = await db
    .selectFrom("campaign_unsubscribes")
    .innerJoin(
      "automation_email_nodes",
      "automation_email_nodes.id",
      "campaign_unsubscribes.automation_email_node_id",
    )
    .select(["automation_email_nodes.node_id as node_id", db.fn.countAll().as("count")])
    .where("automation_email_nodes.automation_id", "=", automationId)
    .groupBy("automation_email_nodes.node_id")
    .execute();
  const unsubBy = new Map(unsubRows.map((r) => [r.node_id, Number(r.count)]));

  const steps: AutomationReportStep[] = nodes.map((node) => {
    const contacts = runsBy.get(node.id) ?? 0;
    const stats = emailBy.get(node.id);
    const isEmail = node.type === "send_custom_email";
    const subject = typeof node.config.subject === "string" ? node.config.subject : "";
    return {
      node_id: node.id,
      type: node.type,
      label: node.title?.trim() || getAction(node.type)?.label || node.type,
      contacts,
      pct: share(contacts, entered),
      drop_pct: entered > 0 ? 100 - share(contacts, entered) : 0,
      email: isEmail
        ? {
            subject,
            sent: stats?.sent ?? 0,
            opens: stats?.opens ?? 0,
            unique_opens: stats?.unique_opens ?? 0,
            clicks: stats?.clicks ?? 0,
            unique_clicks: stats?.unique_clicks ?? 0,
            unsubscribes: unsubBy.get(node.id) ?? 0,
            links: stats?.links ?? [],
          }
        : null,
    };
  });

  return {
    entered,
    enrollment_counts,
    steps,
    conversion_pct: steps.length > 0 ? (steps[steps.length - 1]?.pct ?? 0) : 0,
  };
}
