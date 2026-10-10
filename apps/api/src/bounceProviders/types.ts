import type { BounceType } from "../db/types.js";

/** One setting a provider needs, described as data so the admin UI renders the
 * form for any provider without provider-specific code. `password` fields are
 * secrets: masked on read, and an empty value on write keeps the stored one. */
export interface BounceProviderField {
  key: string;
  label: string;
  type: "text" | "password" | "number";
  required?: boolean;
  placeholder?: string;
  help?: string;
}

/** A failed delivery, normalised out of whatever the provider's log looks
 * like. Anything the provider can't tell apart from "still in flight" must not
 * be returned: a bounce blocklists someone. */
export interface PolledFailure {
  /** Stable for the same underlying log entry across polls -- the dedupe key. */
  key: string;
  recipient: string;
  /** Message-ID as sent, angle brackets included, when the log carries it. */
  messageId: string | null;
  type: BounceType;
  /** The provider's own wording, kept on the bounce row for debugging. */
  detail: string;
}

export interface FetchFailuresInput {
  settings: Record<string, unknown>;
  /** Only look at mail accepted at or after this moment. */
  since: Date;
}

/**
 * A provider whose delivery log can be read over an API. Adding one is a new
 * file under bounceProviders/ plus an entry in index.ts -- nothing else in the
 * poller, routes or UI names a provider.
 */
export interface BounceProvider {
  key: string;
  label: string;
  description: string;
  fields: BounceProviderField[];
  /** Cheap authenticated call; throws with a readable message on failure. */
  verify(settings: Record<string, unknown>): Promise<void>;
  fetchFailures(input: FetchFailuresInput): Promise<PolledFailure[]>;
}
