import { createHmac, timingSafeEqual } from "node:crypto";

/** Stateless HMAC signing for tracking/unsubscribe URLs -- no token table needed. */
export function sign(secret: string, parts: string[], length = 24): string {
  return createHmac("sha256", secret).update(parts.join(":")).digest("hex").slice(0, length);
}

/** `length` must be passed by the caller rather than taken from `signature`,
 * or a one-character signature would only ever be compared against one
 * character of the expected digest. */
export function verify(secret: string, parts: string[], signature: string, length = 24): boolean {
  const expected = sign(secret, parts, length);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
