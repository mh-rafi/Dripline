import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { AutomationGraph, orderedNodes } from "../lib/automationGraph.js";
import { getTrigger, TRIGGERS } from "../automations/triggers.js";
import { ACTIONS, getAction } from "../automations/actions.js";
import { enroll, fireEvent, getAutomationOrThrow, recordEvent } from "../services/automations.js";

const IdParam = z.object({ id: z.coerce.number() });

const CreateAutomation = z.object({
  name: z.string().min(1),
  trigger_type: z.string().min(1),
  trigger_config: z.record(z.string(), z.unknown()).default({}),
});

const UpdateAutomation = z.object({
  name: z.string().min(1).optional(),
  trigger_config: z.record(z.string(), z.unknown()).optional(),
  graph: AutomationGraph.optional(),
  status: z.enum(["draft", "published", "paused"]).optional(),
  reentry_mode: z.enum(["once", "multiple"]).optional(),
});

/** Structural checks that hold for any saved graph -- unique ids, edges that
 * point at real nodes, and an entry that exists. Per-node *config* validation
 * is deliberately deferred to publish time so a half-configured node can be
 * saved while the author is still working on it. */
function assertStructurallyValid(graph: AutomationGraph): void {
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) throw new BadRequestError(`duplicate node id "${node.id}"`);
    ids.add(node.id);
  }
  if (graph.entry && !ids.has(graph.entry)) {
    throw new BadRequestError("graph entry points at a node that does not exist");
  }
  for (const node of graph.nodes) {
    if (node.next && !ids.has(node.next)) {
      throw new BadRequestError(`node "${node.id}" points at a node that does not exist`);
    }
  }
}

function assertPublishable(graph: AutomationGraph, triggerType: string, triggerConfig: unknown) {
  const trigger = getTrigger(triggerType);
  if (!trigger) throw new BadRequestError(`unknown trigger type "${triggerType}"`);

  const parsedTrigger = safeParseNode(trigger.parseConfig, triggerConfig);
  if (!parsedTrigger.ok) {
    throw new BadRequestError(`"${trigger.label}" is not fully configured: ${parsedTrigger.error}`);
  }
  if (!graph.entry) throw new BadRequestError("add at least one action before publishing");

  for (const node of orderedNodes(graph)) {
    const action = getAction(node.type);
    if (!action) throw new BadRequestError(`unknown action type "${node.type}"`);
    const parsed = safeParseNode(action.parseConfig, node.config);
    if (!parsed.ok) {
      throw new BadRequestError(`"${action.label}" is not fully configured: ${parsed.error}`);
    }
  }
}

function safeParseNode(
  parseConfig: (config: unknown) => unknown,
  config: unknown,
): { ok: true } | { ok: false; error: string } {
  try {
    parseConfig(config);
    return { ok: true };
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issue = err.issues[0];
      return {
        ok: false,
        error: issue ? `${issue.path.join(".") || "config"} ${issue.message}` : "invalid config",
      };
    }
    return { ok: false, error: "invalid config" };
  }
}

export default async function automationRoutes(app: FastifyInstance, opts: { db: DB }) {
  const { db } = opts;

  // --- Public ingress (own scope: no requireAuth) --------------------------
  // The per-automation key in the URL *is* the credential -- it is generated
  // server-side at creation and only ever shown inside the builder.
  app.register(async (publicApp) => {
    publicApp.post("/api/v1/automations/hooks/:key", async (req, reply) => {
      const { key } = z.object({ key: z.string().min(1) }).parse(req.params);
      const body = z
        .object({
          email: z.string().email().optional(),
          subscriber_id: z.number().int().optional(),
          name: z.string().optional(),
          attribs: z.record(z.string(), z.unknown()).optional(),
        })
        .and(z.record(z.string(), z.unknown()))
        .parse(req.body ?? {});

      let subscriberId = body.subscriber_id ?? null;
      if (!subscriberId && body.email) {
        const { createSubscriber } = await import("../services/subscribers.js");
        const subscriber = await createSubscriber(db, {
          email: body.email,
          name: body.name,
          attribs: body.attribs,
        });
        subscriberId = subscriber.id;
      }
      if (!subscriberId) return reply.code(400).send({ error: "email or subscriber_id required" });

      await recordEvent(db, {
        source: "webhook_incoming",
        eventKey: key,
        subscriberId,
        payload: body,
      });
      await fireEvent(db, {
        type: "webhook_incoming",
        subscriberId,
        data: { key, payload: body },
      });
      return { ok: true };
    });
  });

  // --- Authenticated management -------------------------------------------
  app.register(async (adminApp) => {
    adminApp.addHook("preHandler", adminApp.requireAuth);

    /** Trigger/action catalogue, so the builder's picker and the API can never
     * drift on what actually exists. */
    adminApp.get("/api/v1/automations/registry", async () => ({
      triggers: TRIGGERS.map(({ type, label, description, group }) => ({
        type,
        label,
        description,
        group,
      })),
      actions: ACTIONS.map(({ type, label, description, group }) => ({
        type,
        label,
        description,
        group,
      })),
    }));

    adminApp.get("/api/v1/automations", async () => {
      const automations = await db
        .selectFrom("automations")
        .selectAll()
        .orderBy("id", "desc")
        .execute();

      const counts = await db
        .selectFrom("automation_enrollments")
        .select(["automation_id", "status", db.fn.countAll<string>().as("count")])
        .groupBy(["automation_id", "status"])
        .execute();

      return automations.map((automation) => ({
        ...automation,
        enrollment_counts: counts
          .filter((c) => c.automation_id === automation.id)
          .map(({ status, count }) => ({ status, count })),
      }));
    });

    adminApp.get("/api/v1/automations/:id", async (req) => {
      const { id } = IdParam.parse(req.params);
      const automation = await getAutomationOrThrow(db, id);
      const enrollment_counts = await db
        .selectFrom("automation_enrollments")
        .select(["status", db.fn.countAll<string>().as("count")])
        .where("automation_id", "=", id)
        .groupBy("status")
        .execute();
      return { ...automation, enrollment_counts };
    });

    adminApp.post("/api/v1/automations", async (req, reply) => {
      const body = CreateAutomation.parse(req.body);
      const trigger = getTrigger(body.trigger_type);
      if (!trigger) throw new BadRequestError(`unknown trigger type "${body.trigger_type}"`);

      const trigger_config = {
        ...(trigger.createDefaults?.() ?? {}),
        ...body.trigger_config,
      };

      const automation = await db
        .insertInto("automations")
        .values({
          name: body.name,
          trigger_type: body.trigger_type,
          trigger_config,
          graph: { entry: null, nodes: [] },
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      reply.code(201);
      return automation;
    });

    adminApp.patch("/api/v1/automations/:id", async (req) => {
      const { id } = IdParam.parse(req.params);
      const body = UpdateAutomation.parse(req.body);
      const existing = await getAutomationOrThrow(db, id);

      const graph = body.graph ?? AutomationGraph.parse(existing.graph);
      if (body.graph) assertStructurallyValid(body.graph);

      const trigger_config = body.trigger_config ?? existing.trigger_config;
      if (body.status === "published") {
        assertPublishable(graph, existing.trigger_type, trigger_config);
      }

      const automation = await db
        .updateTable("automations")
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.trigger_config !== undefined ? { trigger_config: body.trigger_config } : {}),
          ...(body.graph !== undefined ? { graph: body.graph } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.reentry_mode !== undefined ? { reentry_mode: body.reentry_mode } : {}),
        })
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();
      if (!automation) throw new NotFoundError("automation");
      return automation;
    });

    adminApp.delete("/api/v1/automations/:id", async (req) => {
      const { id } = IdParam.parse(req.params);
      await db.deleteFrom("automations").where("id", "=", id).execute();
      return { ok: true };
    });

    adminApp.post("/api/v1/automations/:id/enroll", async (req) => {
      const { id } = IdParam.parse(req.params);
      const { subscriber_id } = z.object({ subscriber_id: z.number().int() }).parse(req.body);
      await enroll(db, id, subscriber_id);
      return { ok: true };
    });

    adminApp.get("/api/v1/automations/:id/enrollments", async (req) => {
      const { id } = IdParam.parse(req.params);
      return db
        .selectFrom("automation_enrollments")
        .innerJoin("subscribers", "subscribers.id", "automation_enrollments.subscriber_id")
        .select([
          "automation_enrollments.id",
          "automation_enrollments.status",
          "automation_enrollments.current_node_id",
          "automation_enrollments.next_run_at",
          "automation_enrollments.started_at",
          "automation_enrollments.completed_at",
          "subscribers.id as subscriber_id",
          "subscribers.email",
        ])
        .where("automation_id", "=", id)
        .orderBy("automation_enrollments.id", "desc")
        .limit(200)
        .execute();
    });
  });
}
