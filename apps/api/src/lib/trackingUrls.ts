import type { Config } from "../config.js";
import { decodeId, encodeId } from "./shortId.js";
import { sign, verify } from "./signing.js";

/**
 * Every URL that ends up inside a sent email, in its short form.
 *
 * SpamAssassin penalizes links much over 120 characters, and the old shape
 * (`/api/v1/track/click/{uuid}/{uuid}?url={the whole encoded destination}&sig=`)
 * ran to ~260. Base62 ids replace the uuids, a link id replaces the embedded
 * destination, and the paths are one letter -- which lands a click URL at
 * roughly 55 characters. See docs/plan/deliverability.md.
 *
 * The old `/api/v1/track/*` and `/unsubscribe/*` routes still exist and must
 * keep existing: mail already sitting in inboxes carries them.
 */

/** 64 bits of HMAC-SHA256. Only ever attacked online against a live endpoint,
 * where 2^64 guesses is not a threat, and every hex character saved counts
 * against the 120-character budget. */
const SIG_LEN = 16;

export type UnsubscribeKind = "campaign" | "automation";

export function verifyTrackingSig(config: Config, parts: string[], signature: string): boolean {
  return verify(config.trackingSecret, parts, signature, SIG_LEN);
}

export function clickUrl(
  config: Config,
  ids: { campaignId: number; subscriberId: number; linkId: number },
): string {
  const c = encodeId(ids.campaignId);
  const s = encodeId(ids.subscriberId);
  const k = encodeId(ids.linkId);
  const sig = sign(config.trackingSecret, ["l", c, s, k], SIG_LEN);
  return `${config.appUrl}/l/${c}/${s}/${k}/${sig}`;
}

export function openPixelUrl(
  config: Config,
  ids: { campaignId: number; subscriberId: number },
): string {
  const c = encodeId(ids.campaignId);
  const s = encodeId(ids.subscriberId);
  const sig = sign(config.trackingSecret, ["o", c, s], SIG_LEN);
  return `${config.appUrl}/o/${c}/${s}/${sig}`;
}

/** Campaign and automation unsubscribes share one page and one endpoint, so
 * the ref carries which kind it is. The uuid form had to settle that with a
 * lookup in both tables (resolveUnsubscribeOrigin); this doesn't. */
export function unsubscribeRef(kind: UnsubscribeKind, id: number): string {
  return (kind === "campaign" ? "c" : "a") + encodeId(id);
}

export function parseUnsubscribeRef(ref: string): { kind: UnsubscribeKind; id: number } | null {
  const kind = ref[0] === "c" ? "campaign" : ref[0] === "a" ? "automation" : null;
  if (!kind) return null;
  const id = decodeId(ref.slice(1));
  return id === null ? null : { kind, id };
}

function unsubscribeSig(config: Config, ref: string, s: string): string {
  return sign(config.trackingSecret, ["u", ref, s], SIG_LEN);
}

/** What a human clicks in the body: a page offering per-list choice. */
export function unsubscribePageUrl(config: Config, ref: string, subscriberId: number): string {
  const s = encodeId(subscriberId);
  return `${config.appUrl}/u/${ref}/${s}/${unsubscribeSig(config, ref, s)}`;
}

/** The RFC 8058 one-click target for the List-Unsubscribe header. Same
 * signature as the page -- one link, two ways in. */
export function unsubscribeOneClickUrl(config: Config, ref: string, subscriberId: number): string {
  const s = encodeId(subscriberId);
  return `${config.appUrl}/api/v1/u/${ref}/${s}/${unsubscribeSig(config, ref, s)}`;
}
