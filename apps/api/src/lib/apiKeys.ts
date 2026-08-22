import { createHash } from "node:crypto";
import { nanoid } from "nanoid";

const PREFIX = "dk";

export interface GeneratedApiKey {
  /** Full plaintext key -- shown to the user exactly once. */
  plain: string;
  /** Non-secret prefix stored for fast lookup. */
  prefix: string;
  /** SHA-256 hash of the full key -- what's persisted. */
  hash: string;
}

export function generateApiKey(): GeneratedApiKey {
  const prefix = `${PREFIX}_${nanoid(8)}`;
  const secret = nanoid(32);
  const plain = `${prefix}_${secret}`;
  return { plain, prefix, hash: hashApiKey(plain) };
}

export function hashApiKey(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

export function extractPrefix(plain: string): string | null {
  const parts = plain.split("_");
  if (parts.length < 3 || parts[0] !== PREFIX) return null;
  return `${parts[0]}_${parts[1]}`;
}
