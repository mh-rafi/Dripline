import { z } from "zod";

const DelayStep = z.object({
  type: z.literal("delay"),
  duration_seconds: z.number().int().positive(),
});
const SendEmailStep = z.object({
  type: z.literal("send_email"),
  subject: z.string(),
  body: z.string(),
  template_id: z.number().int().optional(),
  /** Primary connection this step sends through. */
  connection_id: z.number().int().optional(),
  /** Optional ordered fallback connections (primary first, then these). */
  fallback_connection_ids: z.array(z.number().int()).optional(),
});
const AddTagStep = z.object({ type: z.literal("add_tag"), tag: z.string() });
const RemoveTagStep = z.object({ type: z.literal("remove_tag"), tag: z.string() });
const AddListStep = z.object({ type: z.literal("add_list"), list_id: z.number().int() });
const RemoveListStep = z.object({ type: z.literal("remove_list"), list_id: z.number().int() });
const ConditionStep = z.object({
  type: z.literal("condition"),
  field: z.string(),
  operator: z.enum(["eq", "neq", "exists", "not_exists", "contains"]),
  value: z.unknown().optional(),
  else_jump: z.number().int().optional(),
});
const WebhookOutStep = z.object({
  type: z.literal("webhook_out"),
  url: z.string().url(),
  payload: z.record(z.unknown()).optional(),
});

export const WorkflowStep = z.discriminatedUnion("type", [
  DelayStep,
  SendEmailStep,
  AddTagStep,
  RemoveTagStep,
  AddListStep,
  RemoveListStep,
  ConditionStep,
  WebhookOutStep,
]);

export const WorkflowSteps = z.array(WorkflowStep);
export type WorkflowStep = z.infer<typeof WorkflowStep>;

export function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

export function evaluateCondition(
  step: z.infer<typeof ConditionStep>,
  attribs: Record<string, unknown>,
): boolean {
  const actual = getByPath(attribs, step.field);
  switch (step.operator) {
    case "eq":
      return actual === step.value;
    case "neq":
      return actual !== step.value;
    case "exists":
      return actual !== undefined && actual !== null;
    case "not_exists":
      return actual === undefined || actual === null;
    case "contains":
      return Array.isArray(actual) && actual.includes(step.value);
    default:
      return false;
  }
}
