import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { Automation, List } from "../lib/types.js";

export type NodeConfig = Record<string, unknown>;

export interface SettingsProps {
  config: NodeConfig;
  onChange: (config: NodeConfig) => void;
  automation: Automation;
  /** The graph node being edited. Absent for the trigger panel, which is the
   * automation itself rather than a node. */
  nodeId?: string;
}

export interface SummaryContext {
  lists: List[];
}

/** What the canvas and sidebar need to know about a trigger or an action.
 * Adding either is one entry here plus one in the API registry -- nothing in
 * the canvas, the sidebar or the engine switches on a node type. */
export interface NodeUi {
  type: string;
  label: string;
  description: string;
  icon: LucideIcon;
  group: string;
  defaultConfig: NodeConfig;
  /** The one-liner under the block's title on the canvas. */
  summary: (config: NodeConfig, ctx: SummaryContext) => string;
  /** What's still missing before this block can run, or null when it's ready.
   * Mirrors the API's zod schema for the same node type (see
   * `apps/api/src/automations/`) -- the API is what actually blocks publishing;
   * this is what puts the warning on the block so nobody has to hit publish to
   * find out. */
  validate?: (config: NodeConfig) => string | null;
  Settings?: ComponentType<SettingsProps>;
}

export function listIdsOf(config: NodeConfig): number[] {
  const value = config.list_ids;
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is number => typeof v === "number");
}

export function listNames(listIds: number[], lists: List[]): string {
  if (listIds.length === 0) return "";
  return listIds.map((id) => lists.find((l) => l.id === id)?.name ?? `List #${id}`).join(", ");
}

export function stringOf(config: NodeConfig, key: string, fallback = ""): string {
  const value = config[key];
  return typeof value === "string" ? value : fallback;
}

export function boolOf(config: NodeConfig, key: string, fallback = false): boolean {
  const value = config[key];
  return typeof value === "boolean" ? value : fallback;
}

export function numberOf(config: NodeConfig, key: string, fallback: number): number {
  const value = config[key];
  return typeof value === "number" ? value : fallback;
}
