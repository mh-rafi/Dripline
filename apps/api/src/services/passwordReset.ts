import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "kysely";
import type { DB } from "../db/kysely.js";
import type { Config } from "../config.js";
import { hashPassword } from "../lib/password.js";
import { BadRequestError } from "../lib/errors.js";
import { renderPasswordResetEmail, sendSystemEmail } from "./systemMailer.js";

export const RESET_TOKEN_TTL_MINUTES = 60;

/** How long a request has to wait before it will send another mail for the
 * same account. Stops a "forgot password" form from being turned into a way
 * to flood someone's inbox, without ever telling the caller which addresses
 * are real. */
const RESEND_COOLDOWN_SECONDS = 60;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Marks every password change in one place so the invariant is impossible to
 * forget: bumping `password_changed_at` is what evicts sessions minted under
 * the old password (see auth/plugin.ts). */
export async function setPassword(db: DB, userId: number, plain: string): Promise<Date> {
  const changedAt = new Date();
  await db
    .updateTable("users")
    .set({ password_hash: await hashPassword(plain), password_changed_at: changedAt })
    .where("id", "=", userId)
    .execute();
  return changedAt;
}

/**
 * Always resolves, whether or not the address belongs to an account: the
 * caller returns the same response either way, so this endpoint can't be used
 * to enumerate which emails have accounts. A missing system connection is
 * likewise not surfaced here -- an admin who has not configured one finds out
 * from the test button in Settings → System, not from a stranger's probe.
 */
export async function requestPasswordReset(db: DB, config: Config, email: string): Promise<void> {
  const user = await db
    .selectFrom("users")
    .select(["id", "name", "email", "status"])
    .where("email", "=", email)
    .where("type", "=", "user")
    .executeTakeFirst();
  if (!user?.email || user.status !== "enabled") return;

  const recent = await db
    .selectFrom("password_reset_tokens")
    .select("id")
    .where("user_id", "=", user.id)
    .where(
      sql<boolean>`created_at > NOW() - (${RESEND_COOLDOWN_SECONDS}::int * INTERVAL '1 second')`,
    )
    .executeTakeFirst();
  if (recent) return;

  // Outstanding links for this account stop working the moment a new one is
  // issued, so a forwarded or intercepted older mail is worthless.
  await db.deleteFrom("password_reset_tokens").where("user_id", "=", user.id).execute();

  const token = randomBytes(32).toString("base64url");
  await db
    .insertInto("password_reset_tokens")
    .values({
      user_id: user.id,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000),
    })
    .execute();

  const { subject, html } = renderPasswordResetEmail({
    name: user.name,
    resetUrl: `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`,
    expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
  });
  await sendSystemEmail(db, { to: user.email, subject, html });
}

export async function resetPassword(db: DB, token: string, password: string): Promise<void> {
  const candidate = await db
    .selectFrom("password_reset_tokens")
    .selectAll()
    .where("token_hash", "=", hashToken(token))
    .executeTakeFirst();

  // The lookup above is already by hash, so this comparison only guards the
  // case where two hashes collide in the index scan -- kept constant-time for
  // the same reason lib/signing.ts is.
  const valid =
    candidate &&
    timingSafeEqual(Buffer.from(candidate.token_hash), Buffer.from(hashToken(token))) &&
    candidate.used_at === null &&
    new Date(candidate.expires_at).getTime() > Date.now();
  if (!valid) throw new BadRequestError("this reset link is invalid or has expired");

  await setPassword(db, candidate.user_id, password);
  await db.deleteFrom("password_reset_tokens").where("user_id", "=", candidate.user_id).execute();
}

/** Opportunistic cleanup so the table doesn't accumulate dead rows on an
 * instance where nobody ever completes a reset. */
export async function purgeExpiredResetTokens(db: DB): Promise<void> {
  await db.deleteFrom("password_reset_tokens").where("expires_at", "<", new Date()).execute();
}
