const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Longest input decodeId will look at. 62^10 overflows Number.MAX_SAFE_INTEGER,
 * so this is a cheap guard against a hostile path segment before the loop runs. */
const MAX_LEN = 9;

/**
 * Base62 for the campaign/subscriber/link ids embedded in tracking URLs. A
 * 36-character uuid per id put those links past the ~120-character mark that
 * SpamAssassin penalizes -- see docs/plan/deliverability.md.
 */
export function encodeId(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`cannot encode id ${n}`);
  if (n === 0) return "0";
  let out = "";
  let rest = n;
  while (rest > 0) {
    out = ALPHABET[rest % 62] + out;
    rest = Math.floor(rest / 62);
  }
  return out;
}

/** Null rather than throwing: every caller is a route handler decoding a
 * segment that a stranger controls. */
export function decodeId(s: string): number | null {
  if (!s || s.length > MAX_LEN) return null;
  let n = 0;
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    n = n * 62 + v;
  }
  return Number.isSafeInteger(n) ? n : null;
}
