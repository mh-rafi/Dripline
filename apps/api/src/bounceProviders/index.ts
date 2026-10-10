import { mailbaby } from "./mailbaby.js";
import type { BounceProvider } from "./types.js";

export type { BounceProvider, BounceProviderField, PolledFailure } from "./types.js";

const PROVIDERS: BounceProvider[] = [mailbaby];

export function listBounceProviders(): BounceProvider[] {
  return PROVIDERS;
}

export function getBounceProvider(key: string): BounceProvider | undefined {
  return PROVIDERS.find((p) => p.key === key);
}

/** Required-field and type checks driven by the provider's own descriptors,
 * so a new provider gets validation without writing any. Returns the first
 * problem as a message, or null. */
export function validateProviderSettings(
  provider: BounceProvider,
  settings: Record<string, unknown>,
): string | null {
  for (const field of provider.fields) {
    const value = settings[field.key];
    const empty = value === undefined || value === null || value === "";
    if (empty) {
      if (field.required) return `${field.label} is required`;
      continue;
    }
    if (field.type === "number" && !Number.isFinite(Number(value))) {
      return `${field.label} must be a number`;
    }
  }
  return null;
}
