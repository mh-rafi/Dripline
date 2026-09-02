import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import type { Config } from "../config.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { AutomationGraph, orderedNodes } from "../lib/automationGraph.js";
import { getTrigger, TRIGGERS } from "../automations/triggers.js";
import { ACTIONS, getAction } from "../automations/actions.js";
import {
  SendCustomEmailConfig,
  SendCustomEmailPreview,
  renderAutomationEmail,
} from "../automations/email.js";
import { getExplicitConnectionChain, sendWithChain } from "../services/connections.js";
import { syntheticSubscriber } from "../services/campaigns.js";
import { plainTextPreviewHtml } from "../services/mailer.js";
import { enroll, fireEvent, getAutomationOrThrow, recordEvent } from "../services/automations.js";
import { getAutomationUnsubscribeCounts } from "../services/unsubscribes.js";
import { getAutomationEmailStats } from "../services/automationEmailStats.js";
import { getAutomationReport } from "../services/automationReport.js";

const IdParam = z.object({ id: z.coerce.number() });

const EnrollmentParams = z.object({
  id: z.coerce.number(),
  enrollmentId: z.string().regex(/^\d+$/),
});

/** The node's own config, plus who to send to. Kept loose (passthrough of
 * the config fields) so it can be validated by the action's real schema
 * below rather than being duplicated here. */
const EnrollmentsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(25),
  status: z.enum(["all", "active", "completed", "cancelled"]).default("all"),
  query: z.string().trim().default(""),
});

const TestEmail = z
  .object({ email: z.string().email(), name: z.string().optional() })
  .passthrough();

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

export default async function automationRoutes(
  app: FastifyInstance,
  opts: { db: DB; config: Config },
) {
  const { db, config } = opts;

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
        // Merge, never replace: repeated events for one contact each carry a
        // partial payload, so a replace would have every webhook wipe what the
        // last one stored (tags included).
        const { subscriber } = await createSubscriber(db, {
          email: body.email,
          name: body.name,
          attribs: body.attribs,
          attribsMode: "merge",
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
    adminApp.get(
      "/api/v1/automations/registry",
      { preHandler: adminApp.requirePermission("automations:get") },
      async () => ({
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
      }),
    );

    adminApp.get(
      "/api/v1/automations",
      { preHandler: adminApp.requirePermission("automations:get") },
      async () => {
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
      },
    );

    adminApp.get(
      "/api/v1/automations/:id",
      { preHandler: adminApp.requirePermission("automations:get") },
      async (req) => {
        const { id } = IdParam.parse(req.params);
        const automation = await getAutomationOrThrow(db, id);
        const enrollment_counts = await db
          .selectFrom("automation_enrollments")
          .select(["status", db.fn.countAll<string>().as("count")])
          .where("automation_id", "=", id)
          .groupBy("status")
          .execute();
        return { ...automation, enrollment_counts };
      },
    );

    adminApp.post(
      "/api/v1/automations",
      { preHandler: adminApp.requirePermission("automations:manage") },
      async (req, reply) => {
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
      },
    );

    adminApp.patch(
      "/api/v1/automations/:id",
      { preHandler: adminApp.requirePermission("automations:manage") },
      async (req) => {
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
      },
    );

    adminApp.delete(
      "/api/v1/automations/:id",
      { preHandler: adminApp.requirePermission("automations:manage") },
      async (req) => {
        const { id } = IdParam.parse(req.params);
        await db.deleteFrom("automations").where("id", "=", id).execute();
        return { ok: true };
      },
    );

    adminApp.post(
      "/api/v1/automations/:id/enroll",
      { preHandler: adminApp.requirePermission("automations:manage") },
      async (req) => {
        const { id } = IdParam.parse(req.params);
        const { subscriber_id } = z.object({ subscriber_id: z.number().int() }).parse(req.body);
        await enroll(db, id, subscriber_id);
        return { ok: true };
      },
    );

    /** Paginated, searchable enrollment list -- what the report page's
     * "Individual reporting" table reads. Returns the contact's position
     * (`current_node_id`) rather than a rendered label: the page has the graph
     * and can name the node itself, and a node renamed later then reads
     * correctly for historical rows too. */
    adminApp.get(
      "/api/v1/automations/:id/enrollments",
      { preHandler: adminApp.requirePermission("automations:get") },
      async (req) => {
        const { id } = IdParam.parse(req.params);
        const { page, per_page, status, query } = EnrollmentsQuery.parse(req.query);
        // Narrowed out of the "all" sentinel so Kysely sees only real statuses.
        const statusFilter = status === "all" ? null : status;

        const base = db
          .selectFrom("automation_enrollments")
          .innerJoin("subscribers", "subscribers.id", "automation_enrollments.subscriber_id")
          .where("automation_enrollments.automation_id", "=", id)
          .$if(statusFilter !== null, (qb) =>
            qb.where("automation_enrollments.status", "=", statusFilter!),
          )
          .$if(query.length > 0, (qb) =>
            qb.where(({ or, eb }) =>
              or([
                eb("subscribers.email", "ilike", `%${query}%`),
                eb("subscribers.name", "ilike", `%${query}%`),
              ]),
            ),
          );

        const [rows, total] = await Promise.all([
          base
            .select([
              "automation_enrollments.id",
              "automation_enrollments.status",
              "automation_enrollments.current_node_id",
              "automation_enrollments.next_run_at",
              "automation_enrollments.started_at",
              "automation_enrollments.completed_at",
              "automation_enrollments.updated_at",
              "subscribers.id as subscriber_id",
              "subscribers.email",
              "subscribers.name",
            ])
            .orderBy("automation_enrollments.id", "desc")
            .limit(per_page)
            .offset((page - 1) * per_page)
            .execute(),
          base.select(db.fn.countAll().as("count")).executeTakeFirstOrThrow(),
        ]);

        return { enrollments: rows, total: Number(total.count), page, per_page };
      },
    );

    /** Stops a contact's run without deleting the history of it. */
    adminApp.post(
      "/api/v1/automations/:id/enrollments/:enrollmentId/cancel",
      { preHandler: adminApp.requirePermission("automations:manage") },
      async (req) => {
        const { id, enrollmentId } = EnrollmentParams.parse(req.params);
        const updated = await db
          .updateTable("automation_enrollments")
          .set({ status: "cancelled", next_run_at: null, completed_at: new Date() })
          .where("id", "=", enrollmentId)
          .where("automation_id", "=", id)
          .where("status", "=", "active")
          .returning("id")
          .executeTakeFirst();
        if (!updated) throw new NotFoundError("active enrollment");
        return { ok: true };
      },
    );

    /** Removes the enrollment outright. Its node-run rows go with it (ON
     * DELETE CASCADE), so the funnel forgets the contact too -- unlike cancel,
     * which leaves them counted at every step they actually reached. */
    adminApp.delete(
      "/api/v1/automations/:id/enrollments/:enrollmentId",
      { preHandler: adminApp.requirePermission("automations:manage") },
      async (req) => {
        const { id, enrollmentId } = EnrollmentParams.parse(req.params);
        await db
          .deleteFrom("automation_enrollments")
          .where("id", "=", enrollmentId)
          .where("automation_id", "=", id)
          .execute();
        return { ok: true };
      },
    );

    /** The whole funnel in one call: entrance, per-step contact counts, and
     * per-email engagement. Backs every tab of the report page. */
    adminApp.get(
      "/api/v1/automations/:id/report",
      { preHandler: adminApp.requirePermission("automations:get") },
      async (req) => {
        const { id } = IdParam.parse(req.params);
        const automation = await getAutomationOrThrow(db, id);
        return getAutomationReport(db, id, automation.graph);
      },
    );

    adminApp.get(
      "/api/v1/automations/:id/analytics",
      { preHandler: adminApp.requirePermission("automations:get") },
      async (req) => {
        const { id } = IdParam.parse(req.params);
        const [unsubscribes, nodes] = await Promise.all([
          getAutomationUnsubscribeCounts(db, id),
          getAutomationEmailStats(db, id),
        ]);
        return { ...unsubscribes, nodes };
      },
    );

    /** Test-sends one `send_custom_email` node. Mirrors
     * `POST /campaigns/:id/test`: the config comes from the request, not the
     * saved graph, so in-progress edits can be tried before saving, and no
     * enrollment is created or advanced. Rendering goes through the same
     * renderAutomationEmail the live action uses, so what lands in the inbox
     * is what the automation will actually send. */
    adminApp.post(
      "/api/v1/automations/:id/test",
      { preHandler: adminApp.requirePermission("automations:manage") },
      async (req) => {
        const { id } = IdParam.parse(req.params);
        const { email, name, ...rest } = TestEmail.parse(req.body);
        const automation = await getAutomationOrThrow(db, id);

        const parsed = SendCustomEmailConfig.safeParse(rest);
        if (!parsed.success) {
          // A half-configured node is the normal case here (you test while
          // writing), so this is a plain message rather than a 400 the UI
          // would have to special-case.
          const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
          return { ok: false, error: `incomplete email step: ${fields}` };
        }

        const chain = await getExplicitConnectionChain(
          db,
          parsed.data.connection_id,
          parsed.data.fallback_connection_ids,
        );
        if (chain.length === 0) {
          return { ok: false, error: "no sending connection selected for this step" };
        }

        // Use the real contact if the address happens to be one, so merge
        // fields preview with real data; otherwise a synthetic stand-in.
        const existing = await db
          .selectFrom("subscribers")
          .selectAll()
          .where("email", "=", email)
          .executeTakeFirst();
        const subscriber = existing ?? syntheticSubscriber(email, name ?? "Test Subscriber");

        const rendered = await renderAutomationEmail(
          db,
          config,
          automation,
          subscriber,
          parsed.data,
        );
        const result = await sendWithChain(db, chain, {
          to: email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          fromNameOverride: parsed.data.from_name,
          replyTo: parsed.data.reply_to,
          unsubscribeUrl: rendered.unsubscribeUrl,
        });

        return { ok: result.ok, error: result.error };
      },
    );

    /** Renders one email step for the preview pane. Same renderer the live
     * action uses, so the template wrapper, merge fields and unsubscribe link
     * are the real ones -- but no connection is required, since previewing is
     * something you do while the step is still half-written. */
    adminApp.post(
      "/api/v1/automations/:id/preview",
      { preHandler: adminApp.requirePermission("automations:get") },
      async (req) => {
        const { id } = IdParam.parse(req.params);
        const content = SendCustomEmailPreview.parse(req.body);
        const automation = await getAutomationOrThrow(db, id);

        const rendered = await renderAutomationEmail(
          db,
          config,
          automation,
          syntheticSubscriber("preview@example.com", "Preview Subscriber"),
          content,
        );
        return {
          subject: rendered.subject,
          // A plain-text step has no HTML part to show, so the pane gets the
          // text one wrapped for display -- same as previewCampaign.
          html: rendered.html || plainTextPreviewHtml(rendered.text),
        };
      },
    );
  });
}
