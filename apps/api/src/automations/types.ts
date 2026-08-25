import type { Selectable } from "kysely";
import type { z } from "zod";
import type { DB } from "../db/kysely.js";
import type { Config } from "../config.js";
import type {
  AutomationsTable,
  AutomationEnrollmentsTable,
  SubscribersTable,
} from "../db/types.js";
import type { AutomationNode } from "../lib/automationGraph.js";

export type Automation = Selectable<AutomationsTable>;
export type AutomationEnrollment = Selectable<AutomationEnrollmentsTable>;
export type Subscriber = Selectable<SubscribersTable>;

/** Something that happened to a contact, offered to every published automation
 * whose trigger_type matches `type`. */
export interface AutomationEvent {
  type: string;
  subscriberId: number;
  data: Record<string, unknown>;
}

export type ActionGroup = "timing" | "contact" | "email" | "integration";

/** Definitions are generic over their *schema* rather than their config type
 * so `z.infer` resolves each schema's output (defaults applied) -- inferring
 * from a `ZodType<C>` would resolve the input side and make every defaulted
 * field optional at the point of use. */
export interface TriggerDef<S extends z.ZodTypeAny> {
  type: string;
  label: string;
  /** Help text shown under the trigger in the create dialog. */
  description: string;
  group: string;
  configSchema: S;
  /** Server-side config generated when an automation is created with this
   * trigger (e.g. an incoming webhook's secret key). */
  createDefaults?: () => Record<string, unknown>;
  /** Does an automation configured this way care about this event? */
  matches: (config: z.infer<S>, event: AutomationEvent) => boolean;
}

export type ActionResult =
  /** Continue to this node's `next`, optionally not before `delayUntil`. */
  | { kind: "advance"; delayUntil?: Date }
  /** Jump to an explicit node (or end the run with null). The hook conditional
   * branching will use in Phase 3. */
  | { kind: "goto"; nodeId: string | null; delayUntil?: Date }
  /** Re-run this same node later -- e.g. a send that hit a rate limit. */
  | { kind: "retry"; delayUntil?: Date }
  | { kind: "stop"; status: "completed" | "cancelled" };

export interface ActionContext<C = unknown> {
  db: DB;
  config: Config;
  automation: Automation;
  enrollment: AutomationEnrollment;
  subscriber: Subscriber;
  node: AutomationNode;
  /** `node.config` parsed by this action's own schema. */
  settings: C;
}

export interface ActionDef<S extends z.ZodTypeAny> {
  type: string;
  label: string;
  description: string;
  group: ActionGroup;
  configSchema: S;
  execute: (ctx: ActionContext<z.infer<S>>) => Promise<ActionResult>;
}

/** Type-erased registry entries. The generic `TriggerDef`/`ActionDef` give each
 * definition a properly typed config; these wrappers are what the engine and
 * routes hold, so a registry can be a heterogeneous map without `any`. */
export interface RegisteredTrigger {
  type: string;
  label: string;
  description: string;
  group: string;
  createDefaults?: () => Record<string, unknown>;
  parseConfig: (config: unknown) => Record<string, unknown>;
  matches: (config: unknown, event: AutomationEvent) => boolean;
}

export interface RegisteredAction {
  type: string;
  label: string;
  description: string;
  group: ActionGroup;
  parseConfig: (config: unknown) => Record<string, unknown>;
  execute: (ctx: Omit<ActionContext, "settings">) => Promise<ActionResult>;
}

export function defineTrigger<S extends z.ZodTypeAny>(def: TriggerDef<S>): RegisteredTrigger {
  return {
    type: def.type,
    label: def.label,
    description: def.description,
    group: def.group,
    createDefaults: def.createDefaults,
    parseConfig: (config) => def.configSchema.parse(config) as Record<string, unknown>,
    matches: (config, event) => {
      const parsed = def.configSchema.safeParse(config);
      // A trigger whose stored config no longer validates (e.g. the shape
      // changed) simply stops matching rather than throwing inside whatever
      // request fired the event.
      return parsed.success ? def.matches(parsed.data, event) : false;
    },
  };
}

export function defineAction<S extends z.ZodTypeAny>(def: ActionDef<S>): RegisteredAction {
  return {
    type: def.type,
    label: def.label,
    description: def.description,
    group: def.group,
    parseConfig: (config) => def.configSchema.parse(config) as Record<string, unknown>,
    execute: (ctx) =>
      def.execute({ ...ctx, settings: def.configSchema.parse(ctx.node.config) as z.infer<S> }),
  };
}
