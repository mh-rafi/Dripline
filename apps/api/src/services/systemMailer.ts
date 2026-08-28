import type { DB } from "../db/kysely.js";
import { type Connection, sendThroughConnection } from "./connections.js";
import { getSystemSettings } from "./settings.js";

/** Raised when system email is asked for but not usable -- no connection
 * picked in Settings → System, or the one picked was deleted or disabled.
 * Callers that must not leak account existence (forgot-password) swallow it;
 * the settings test endpoint reports it. */
export class SystemMailerError extends Error {}

export async function getSystemConnection(db: DB): Promise<Connection> {
  const { connection_id } = await getSystemSettings(db);
  if (connection_id === null) {
    throw new SystemMailerError(
      "no system email connection configured -- set one in Settings → System",
    );
  }
  const connection = await db
    .selectFrom("connections")
    .selectAll()
    .where("id", "=", connection_id)
    .executeTakeFirst();
  if (!connection) {
    throw new SystemMailerError("the configured system email connection no longer exists");
  }
  if (!connection.enabled) {
    throw new SystemMailerError(`the system email connection "${connection.name}" is disabled`);
  }
  return connection as unknown as Connection;
}

export async function sendSystemEmail(
  db: DB,
  input: { to: string; subject: string; html: string },
): Promise<void> {
  const connection = await getSystemConnection(db);
  const result = await sendThroughConnection(db, connection, input);
  if (!result.ok) {
    throw new SystemMailerError(
      result.error === "rate_limited"
        ? `the system email connection "${connection.name}" is rate limited right now`
        : (result.error ?? "system email failed to send"),
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Deliberately not a Template row: system mail has to work on a fresh install
 * with no templates, and must not be editable into something that no longer
 * carries the reset link. */
function layout(body: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:8px;padding:32px;">
<tr><td style="font-size:14px;line-height:22px;">${body}</td></tr>
</table></td></tr></table></body></html>`;
}

export function renderPasswordResetEmail(input: {
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
}): { subject: string; html: string } {
  const greeting = input.name.trim() ? `Hi ${escapeHtml(input.name.trim())},` : "Hi,";
  return {
    subject: "Reset your Dripline password",
    html: layout(
      `<p style="margin:0 0 16px;">${greeting}</p>` +
        `<p style="margin:0 0 16px;">Use the link below to choose a new password. It expires in ${input.expiresInMinutes} minutes and can only be used once.</p>` +
        `<p style="margin:0 0 24px;"><a href="${escapeHtml(input.resetUrl)}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;">Reset password</a></p>` +
        `<p style="margin:0 0 16px;color:#6b7280;">Or paste this into your browser:<br><span style="word-break:break-all;">${escapeHtml(input.resetUrl)}</span></p>` +
        `<p style="margin:0;color:#6b7280;">If you didn't ask for this, you can ignore this email — your password stays as it is.</p>`,
    ),
  };
}

export function renderSystemTestEmail(): { subject: string; html: string } {
  return {
    subject: "Dripline system email test",
    html: layout(
      `<p style="margin:0 0 16px;">This is a test of your system email connection.</p>` +
        `<p style="margin:0;color:#6b7280;">If it reached you, password reset emails will send through this connection too.</p>`,
    ),
  };
}
