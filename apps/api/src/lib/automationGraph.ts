import { z } from "zod";

/**
 * The stored automation graph. Edges are pointers (`next`) rather than array
 * order so a future `condition` node can carry two outgoing edges without a
 * second model -- see docs/plan/automations_v2.md.
 *
 * `config` is intentionally an opaque record here: each node type's config is
 * validated by its own registry entry (automations/actions.ts), which is what
 * keeps adding an action a one-file change.
 */
export const AutomationNode = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  title: z.string().optional(),
  note: z.string().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  next: z.string().nullable().default(null),
});

export const AutomationGraph = z.object({
  entry: z.string().nullable().default(null),
  nodes: z.array(AutomationNode).default([]),
});

export type AutomationNode = z.infer<typeof AutomationNode>;
export type AutomationGraph = z.infer<typeof AutomationGraph>;

export const EMPTY_GRAPH: AutomationGraph = { entry: null, nodes: [] };

export function findNode(graph: AutomationGraph, nodeId: string | null): AutomationNode | null {
  if (!nodeId) return null;
  return graph.nodes.find((n) => n.id === nodeId) ?? null;
}

/** Walks `entry` -> `next` and returns the reachable nodes in execution order.
 * Cycle-safe: a graph edited into a loop stops at the first repeat rather than
 * hanging the caller. */
export function orderedNodes(graph: AutomationGraph): AutomationNode[] {
  const seen = new Set<string>();
  const out: AutomationNode[] = [];
  let current = findNode(graph, graph.entry);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    out.push(current);
    current = findNode(graph, current.next);
  }
  return out;
}
