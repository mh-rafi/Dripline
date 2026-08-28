import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import { BadRequestError } from "../lib/errors.js";
import { getStore, MediaConfigError } from "../services/media/index.js";
import {
  getSettings,
  MediaSettingsSchema,
  redactSettings,
  resolveMediaSettings,
  saveMediaSettings,
  saveSystemSettings,
  SystemSettingsSchema,
} from "../services/settings.js";
import {
  renderSystemTestEmail,
  sendSystemEmail,
  SystemMailerError,
} from "../services/systemMailer.js";

// Both groups are optional so each settings tab can save only its own without
// having to round-trip (and risk clobbering) the other one.
const UpdateSettings = z.object({
  media: MediaSettingsSchema.optional(),
  system: SystemSettingsSchema.optional(),
});
const TestMediaSettings = z.object({ media: MediaSettingsSchema });
const TestSystemEmail = z.object({ to: z.string().email() });

export default async function settingsRoutes(app: FastifyInstance, opts: { db: DB }) {
  const { db } = opts;
  app.addHook("preHandler", app.requireAuth);

  app.get("/api/v1/settings", { preHandler: app.requirePermission("settings:get") }, async () => {
    return redactSettings(await getSettings(db));
  });

  app.put(
    "/api/v1/settings",
    { preHandler: app.requirePermission("settings:manage") },
    async (req) => {
      const body = UpdateSettings.parse(req.body);
      if (body.media) await saveMediaSettings(db, body.media);
      if (body.system) await saveSystemSettings(db, body.system);
      return redactSettings(await getSettings(db));
    },
  );

  // Tests the settings in the request body rather than the saved ones, so
  // credentials can be verified before they're committed.
  app.post(
    "/api/v1/settings/media/test",
    { preHandler: app.requirePermission("settings:manage") },
    async (req) => {
      const body = TestMediaSettings.parse(req.body);
      const settings = await resolveMediaSettings(db, body.media);
      try {
        await getStore(settings).test();
      } catch (err) {
        if (err instanceof MediaConfigError) throw new BadRequestError(err.message);
        throw new BadRequestError(err instanceof Error ? err.message : "S3 connection failed");
      }
      return { ok: true };
    },
  );

  // Sends through the *saved* system connection, unlike the media test above:
  // the point is to prove that a password reset would actually arrive.
  app.post(
    "/api/v1/settings/system/test",
    { preHandler: app.requirePermission("settings:manage") },
    async (req) => {
      const body = TestSystemEmail.parse(req.body);
      const { subject, html } = renderSystemTestEmail();
      try {
        await sendSystemEmail(db, { to: body.to, subject, html });
      } catch (err) {
        if (err instanceof SystemMailerError) throw new BadRequestError(err.message);
        throw new BadRequestError(err instanceof Error ? err.message : "system email failed");
      }
      return { ok: true };
    },
  );
}
