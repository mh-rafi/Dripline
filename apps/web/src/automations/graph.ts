import type { AutomationGraph, AutomationNode } from "../lib/types.js";

export function newNodeId(): string {
  return `n_${Math.random().toString(36).slice(2, 10)}`;
}

/** Nodes in execution order, following `entry` -> `next`. Cycle-safe. */
export function orderedNodes(graph: AutomationGraph): AutomationNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const out: AutomationNode[] = [];
  let current = graph.entry ? byId.get(graph.entry) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    out.push(current);
    current = current.next ? byId.get(current.next) : undefined;
  }
  return out;
}

/** Inserts `node` directly after `afterNodeId`, or at the top of the flow
 * (right below the trigger) when that is null. */
export function insertNode(
  graph: AutomationGraph,
  afterNodeId: string | null,
  node: AutomationNode,
): AutomationGraph {
  if (afterNodeId === null) {
    return { entry: node.id, nodes: [...graph.nodes, { ...node, next: graph.entry }] };
  }
  const after = graph.nodes.find((n) => n.id === afterNodeId);
  return {
    entry: graph.entry,
    nodes: [
      ...graph.nodes.map((n) => (n.id === afterNodeId ? { ...n, next: node.id } : n)),
      { ...node, next: after?.next ?? null },
    ],
  };
}

export function updateNode(
  graph: AutomationGraph,
  nodeId: string,
  patch: Partial<AutomationNode>,
): AutomationGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
  };
}

/** Removes a node and relinks the path around it, so deleting a step in the
 * middle never orphans everything below it. */
export function deleteNode(graph: AutomationGraph, nodeId: string): AutomationGraph {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return graph;
  return {
    entry: graph.entry === nodeId ? node.next : graph.entry,
    nodes: graph.nodes
      .filter((n) => n.id !== nodeId)
      .map((n) => (n.next === nodeId ? { ...n, next: node.next } : n)),
  };
}
