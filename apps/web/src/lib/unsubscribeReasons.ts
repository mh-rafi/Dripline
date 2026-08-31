/**
 * UI counterpart to apps/api/src/lib/unsubscribeReasons.ts. Adding a reason is
 * one entry in each -- the API validates the stored value, this holds the
 * wording. Keep the `value`s identical; they're what's in the database.
 */
export const UNSUBSCRIBE_REASONS = [
  { value: "too_many", label: "Too many emails" },
  { value: "not_relevant", label: "Content isn't relevant" },
  { value: "never_signed_up", label: "I never signed up" },
  { value: "not_interested", label: "Not interested any more" },
  { value: "other", label: "Other" },
] as const;

export const REASON_COMMENT_MAX = 500;

const BY_VALUE = new Map(UNSUBSCRIBE_REASONS.map((r) => [r.value as string, r.label as string]));

/** Falls back to the raw stored value: a row can name a reason since removed
 * from the registry, and history shouldn't render as blank. */
export function unsubscribeReasonLabel(value: string): string {
  return BY_VALUE.get(value) ?? value;
}
