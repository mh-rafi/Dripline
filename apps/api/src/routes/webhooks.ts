import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import { recordEvent } from "../services/workflows.js";

const WebhookBody = z.object({
  email: z.string().email().optional(),
  subscriber_id: z.number().int().optional(),
});

/**
 * Public ingestion endpoint for event-based automation triggers. Protected by
 * the same API-key/JWT auth as the rest of the API (see docs/prd/PRD.md open
 * questions -- a dedicated per-workflow signing scheme is a good v2 addition).
 */
export default async function webhookRoutes(app: FastifyInstance, opts: { db: DB }) {
  const { db } = opts;
  app.addHook("preHandler", app.requireAuth);

  app.post("/api/v1/webhooks/:eventKey", async (req) => {
    const { eventKey } = z.object({ eventKey: z.string() }).parse(req.params);
    const body = WebhookBody.and(z.record(z.unknown())).parse(req.body ?? {});

    let subscriberId: number | null = body.subscriber_id ?? null;
    if (!subscriberId && body.email) {
      const subscriber = await db
        .insertInto("subscribers")
        .values({ email: body.email })
        .onConflict((oc) => oc.column("email").doUpdateSet({ email: body.email }))
        .returning("id")
        .executeTakeFirstOrThrow();
      subscriberId = subscriber.id;
    }

    await recordEvent(db, { source: "webhook", eventKey, subscriberId, payload: body });
    return { ok: true };
  });
}
