import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/kysely.js";
import { NotFoundError } from "../lib/errors.js";
import { renderTemplate } from "../lib/template.js";

const CreateTemplate = z.object({
  name: z.string().min(1),
  subject: z.string().optional(),
  body: z.string().min(1),
  is_default: z.boolean().optional(),
});
const UpdateTemplate = CreateTemplate.partial();

const PreviewTemplate = z.object({ body: z.string() });

// Stands in for `{{ Body }}` when previewing a template on its own (no real
// campaign content exists yet) -- exercises the same element types the
// default template's CSS targets (headings, links, buttons, hr, blockquote) so
// the preview is actually representative of a real campaign's styling.
const SAMPLE_BODY = `<h2>Sample section heading</h2>
<p>Hi {{ Subscriber.Name }}, this is example paragraph content showing how your template styles
body text and <a href="https://example.com">links</a>.</p>
<p><a class="button-solid" href="https://example.com">Primary button</a>
<a class="button-outline" href="https://example.com">Secondary button</a></p>
<hr>
<blockquote>A sample quoted callout, to preview blockquote styling.</blockquote>`;

export default async function templateRoutes(app: FastifyInstance, opts: { db: DB }) {
  const { db } = opts;
  app.addHook("preHandler", app.requireAuth);

  app.get("/api/v1/templates", { preHandler: app.requirePermission("templates:get") }, async () =>
    db.selectFrom("templates").selectAll().orderBy("id", "desc").execute(),
  );

  app.get(
    "/api/v1/templates/:id",
    { preHandler: app.requirePermission("templates:get") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      const template = await db
        .selectFrom("templates")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      if (!template) throw new NotFoundError("template");
      return template;
    },
  );

  app.post(
    "/api/v1/templates",
    { preHandler: app.requirePermission("templates:manage") },
    async (req, reply) => {
      const body = CreateTemplate.parse(req.body);
      const template = await db
        .insertInto("templates")
        .values({
          name: body.name,
          subject: body.subject ?? "",
          body: body.body,
          is_default: body.is_default ?? false,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      reply.code(201);
      return template;
    },
  );

  app.patch(
    "/api/v1/templates/:id",
    { preHandler: app.requirePermission("templates:manage") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      const body = UpdateTemplate.parse(req.body);
      const template = await db
        .updateTable("templates")
        .set(body)
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();
      if (!template) throw new NotFoundError("template");
      return template;
    },
  );

  // Renders the (possibly unsaved) template body with sample content
  // standing in for {{ Body }}, so a template can be previewed on its own
  // page without needing a real campaign.
  app.post(
    "/api/v1/templates/preview",
    { preHandler: app.requirePermission("templates:get") },
    async (req) => {
      const { body } = PreviewTemplate.parse(req.body);
      const merged = body.includes("{{ Body }}") ? body.replace("{{ Body }}", SAMPLE_BODY) : body;
      const html = renderTemplate(merged, {
        Subscriber: {
          ID: 0,
          UUID: "",
          Email: "preview@example.com",
          Name: "Preview Subscriber",
          Attribs: {},
        },
        Campaign: { ID: 0, UUID: "", Name: "Preview", Subject: "Preview subject" },
        UnsubscribeURL: "#",
      });
      return { html };
    },
  );

  app.delete(
    "/api/v1/templates/:id",
    { preHandler: app.requirePermission("templates:manage") },
    async (req) => {
      const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
      await db.deleteFrom("templates").where("id", "=", id).execute();
      return { ok: true };
    },
  );
}
