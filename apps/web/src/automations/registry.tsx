import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { Automation, List } from "../lib/types.js";

export type NodeConfig = Record<string, unknown>;

export interface SettingsProps {
  config: NodeConfig;
  onChange: (config: NodeConfig) => void;
  automation: Automation;
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

export function numberOf(config: NodeConfig, key: string, fallback: number): number {
  const value = config[key];
  return typeof value === "number" ? value : fallback;
}
