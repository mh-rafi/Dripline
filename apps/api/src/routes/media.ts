import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { deleteMedia, listMedia, MediaConfigError, uploadMedia } from "../services/media/index.js";
import { getMediaSettings } from "../services/settings.js";

const ListQuery = z.object({
  query: z.string().optional(),
  type: z.enum(["image"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(30),
});

export default async function mediaRoutes(app: FastifyInstance, opts: { db: DB }) {
  const { db } = opts;
  app.addHook("preHandler", app.requireAuth);

  app.get("/api/v1/media", { preHandler: app.requirePermission("media:get") }, async (req) => {
    const { query, type, page, per_page } = ListQuery.parse(req.query);
    try {
      return await listMedia(db, { query, type, page, perPage: per_page });
    } catch (err) {
      // An instance that hasn't configured S3 yet should still be able to
      // open the media page and be told what's missing.
      if (err instanceof MediaConfigError) throw new BadRequestError(err.message);
      throw err;
    }
  });

  app.post(
    "/api/v1/media",
    { preHandler: app.requirePermission("media:manage") },
    async (req, reply) => {
      const settings = await getMediaSettings(db);
      const file = await req.file({
        limits: { fileSize: settings.max_size_mb * 1024 * 1024 },
      });
      if (!file) throw new BadRequestError("no file in the request");

      const body = await file.toBuffer().catch(() => {
        // @fastify/multipart aborts the stream once the limit is hit rather
        // than buffering the whole thing to report the real size.
        throw new BadRequestError(
          `file is larger than the ${settings.max_size_mb} MB upload limit`,
        );
      });
      if (file.file.truncated) {
        throw new BadRequestError(
          `file is larger than the ${settings.max_size_mb} MB upload limit`,
        );
      }

      try {
        const item = await uploadMedia(db, {
          filename: file.filename,
          contentType: file.mimetype || "application/octet-stream",
          body,
        });
        reply.code(201);
        return item;
      } catch (err) {
        if (err instanceof MediaConfigError) throw new BadRequestError(err.message);
        throw err;
      }
    },
  );

  app.delete(
    "/api/v1/media/:id",
    { preHandler: app.requirePermission("media:manage") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      if (!(await deleteMedia(db, id))) throw new NotFoundError("media");
      return { ok: true };
    },
  );
}
