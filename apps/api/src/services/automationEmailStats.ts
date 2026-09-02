import { sql } from "kysely";
import type { DB } from "../db/kysely.js";

/** Matches the campaign report's cap for the same reason: a per-link
 * breakdown is a top-N list, not an export. */
const LINK_ACTIVITY_LIMIT = 20;

export interface AutomationEmailNodeStats {
  node_id: string;
  sent: number;
  opens: number;
  unique_opens: number;
  clicks: number;
  unique_clicks: number;
  links: { url: string; clicks: number; unique_clicks: number }[];
}

/**
 * Per-node engagement for one automation's email steps.
 *
 * Rates are left to the caller: like campaigns, these are unique-recipient
 * counts over `sent`, and `sent` is the automation_email_sends log rather than
 * anything derived from enrollments -- a contact can pass the same node twice
 * under `reentry_mode: "multiple"`, and each pass is a real email.
 *
 * Only nodes that have actually sent something appear. A node with tracking
 * switched off still shows a `sent` count, with zeros beside it.
 */
export async function getAutomationEmailStats(
  db: DB,
  automationId: number,
): Promise<AutomationEmailNodeStats[]> {
  const nodes = await db
    .selectFrom("automation_email_nodes")
    .select(["id", "node_id"])
    .where("automation_id", "=", automationId)
    .execute();
  if (nodes.length === 0) return [];

  const ids = nodes.map((n) => n.id);

  const [sends, views, clicks, links] = await Promise.all([
    db
      .selectFrom("automation_email_sends")
      .select(["email_node_id", db.fn.countAll().as("count")])
      .where("email_node_id", "in", ids)
      .groupBy("email_node_id")
      .execute(),
    db
      .selectFrom("automation_views")
      .select([
        "email_node_id",
        db.fn.countAll().as("total"),
        db.fn.count("subscriber_id").distinct().as("unique"),
      ])
      .where("email_node_id", "in", ids)
      .groupBy("email_node_id")
      .execute(),
    db
      .selectFrom("automation_link_clicks")
      .select([
        "email_node_id",
        db.fn.countAll().as("total"),
        db.fn.count("subscriber_id").distinct().as("unique"),
      ])
      .where("email_node_id", "in", ids)
      .groupBy("email_node_id")
      .execute(),
    db
      .selectFrom("automation_link_clicks")
      .innerJoin("links", "links.id", "automation_link_clicks.link_id")
      .select([
        "automation_link_clicks.email_node_id as email_node_id",
        "links.url as url",
        db.fn.countAll().as("clicks"),
        db.fn.count("automation_link_clicks.subscriber_id").distinct().as("unique_clicks"),
      ])
      .where("automation_link_clicks.email_node_id", "in", ids)
      .groupBy(["automation_link_clicks.email_node_id", "links.url"])
      .orderBy(sql`count(distinct automation_link_clicks.subscriber_id)`, "desc")
      .orderBy("links.url", "asc")
      .execute(),
  ]);

  const sendBy = new Map(sends.map((r) => [r.email_node_id, Number(r.count)]));
  const viewBy = new Map(views.map((r) => [r.email_node_id, r]));
  const clickBy = new Map(clicks.map((r) => [r.email_node_id, r]));
  const linksBy = new Map<number, AutomationEmailNodeStats["links"]>();
  for (const row of links) {
    const list = linksBy.get(row.email_node_id) ?? [];
    // Capped per node, not across the whole result -- one chatty node must not
    // crowd every other node's links out of the response.
    if (list.length < LINK_ACTIVITY_LIMIT) {
      list.push({
        url: row.url,
        clicks: Number(row.clicks),
        unique_clicks: Number(row.unique_clicks),
      });
    }
    linksBy.set(row.email_node_id, list);
  }

  return nodes.map((node) => ({
    node_id: node.node_id,
    sent: sendBy.get(node.id) ?? 0,
    opens: Number(viewBy.get(node.id)?.total ?? 0),
    unique_opens: Number(viewBy.get(node.id)?.unique ?? 0),
    clicks: Number(clickBy.get(node.id)?.total ?? 0),
    unique_clicks: Number(clickBy.get(node.id)?.unique ?? 0),
    links: linksBy.get(node.id) ?? [],
  }));
}
