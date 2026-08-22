import { createHmac, timingSafeEqual } from "node:crypto";

/** Stateless HMAC signing for tracking/unsubscribe URLs -- no token table needed. */
export function sign(secret: string, parts: string[]): string {
  return createHmac("sha256", secret).update(parts.join(":")).digest("hex").slice(0, 24);
}

export function verify(secret: string, parts: string[], signature: string): boolean {
  const expected = sign(secret, parts);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
