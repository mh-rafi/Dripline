import { z } from "zod";

/**
 * The reasons the unsubscribe page offers. Registry-driven the same way
 * triggers and actions are: adding one is a single entry here plus its label
 * in the web counterpart (apps/web/src/lib/unsubscribeReasons.ts) -- no
 * migration, and no CHECK constraint to keep in step.
 *
 * `value` is what's stored, so never repurpose one: historical rows keep
 * whatever they were written with, including values since removed from this
 * list.
 */
export const UNSUBSCRIBE_REASONS = [
  { value: "too_many", label: "Too many emails" },
  { value: "not_relevant", label: "Content isn't relevant" },
  { value: "never_signed_up", label: "I never signed up" },
  { value: "not_interested", label: "Not interested any more" },
  { value: "other", label: "Other" },
] as const;

export type UnsubscribeReason = (typeof UNSUBSCRIBE_REASONS)[number]["value"];

export const UnsubscribeReasonEnum = z.enum(
  UNSUBSCRIBE_REASONS.map((r) => r.value) as [UnsubscribeReason, ...UnsubscribeReason[]],
);

/** Long enough for a real sentence or two, short enough that the column can't
 * be used as free storage by anyone holding a valid unsubscribe link. */
export const REASON_COMMENT_MAX = 500;

export const ReasonBody = z.object({
  unsubscribe_id: z.string().min(1).max(32),
  reason: UnsubscribeReasonEnum,
  comment: z.string().max(REASON_COMMENT_MAX).nullish(),
});
