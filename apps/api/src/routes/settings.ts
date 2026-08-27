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
} from "../services/settings.js";

const UpdateSettings = z.object({ media: MediaSettingsSchema });
const TestMediaSettings = z.object({ media: MediaSettingsSchema });

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
      await saveMediaSettings(db, body.media);
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
}
