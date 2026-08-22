import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import { NotFoundError } from "../lib/errors.js";
import { WorkflowSteps } from "../lib/workflowSteps.js";
import { enroll, getWorkflowOrThrow } from "../services/workflows.js";

const CreateWorkflow = z.object({
  name: z.string().min(1),
  trigger_type: z.enum(["list_joined", "tag_applied", "webhook", "link_clicked", "manual"]),
  trigger_config: z.record(z.unknown()).default({}),
  steps: WorkflowSteps.default([]),
  reentry_allowed: z.boolean().default(false),
});
const UpdateWorkflow = CreateWorkflow.partial().extend({
  status: z.enum(["draft", "active", "paused"]).optional(),
});

export default async function workflowRoutes(app: FastifyInstance, opts: { db: DB }) {
  const { db } = opts;
  app.addHook("preHandler", app.requireAuth);

  app.get("/api/v1/workflows", async () =>
    db.selectFrom("workflows").selectAll().orderBy("id", "desc").execute(),
  );

  app.get("/api/v1/workflows/:id", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    const workflow = await getWorkflowOrThrow(db, id);
    const counts = await db
      .selectFrom("workflow_enrollments")
      .select(["status", db.fn.countAll().as("count")])
      .where("workflow_id", "=", id)
      .groupBy("status")
      .execute();
    return { ...workflow, enrollment_counts: counts };
  });

  app.post("/api/v1/workflows", async (req, reply) => {
    const body = CreateWorkflow.parse(req.body);
    const workflow = await db
      .insertInto("workflows")
      // pg serializes top-level JS arrays as Postgres array literals, not JSON --
      // stringify explicitly so this lands correctly in the jsonb `steps` column.
      .values({ ...body, steps: JSON.stringify(body.steps) as unknown as unknown[] })
      .returningAll()
      .executeTakeFirstOrThrow();
    reply.code(201);
    return workflow;
  });

  app.patch("/api/v1/workflows/:id", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    const body = UpdateWorkflow.parse(req.body);
    const workflow = await db
      .updateTable("workflows")
      .set({
        ...body,
        ...(body.steps ? { steps: JSON.stringify(body.steps) as unknown as unknown[] } : {}),
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    if (!workflow) throw new NotFoundError("workflow");
    return workflow;
  });

  app.delete("/api/v1/workflows/:id", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    await db.deleteFrom("workflows").where("id", "=", id).execute();
    return { ok: true };
  });

  app.post("/api/v1/workflows/:id/enroll", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    const { subscriber_id } = z.object({ subscriber_id: z.number().int() }).parse(req.body);
    await enroll(db, id, subscriber_id);
    return { ok: true };
  });

  app.get("/api/v1/workflows/:id/enrollments", async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    return db
      .selectFrom("workflow_enrollments")
      .innerJoin("subscribers", "subscribers.id", "workflow_enrollments.subscriber_id")
      .select([
        "workflow_enrollments.id",
        "workflow_enrollments.status",
        "workflow_enrollments.current_step",
        "workflow_enrollments.next_run_at",
        "subscribers.email",
      ])
      .where("workflow_id", "=", id)
      .orderBy("workflow_enrollments.id", "desc")
      .limit(200)
      .execute();
  });
}
