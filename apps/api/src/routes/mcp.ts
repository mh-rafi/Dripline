import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Model Context Protocol endpoint (Streamable HTTP, stateless).
 *
 * Every tool is a thin wrapper that replays the caller's own bearer token
 * against the matching REST route in-process, so an MCP client gets exactly
 * the permissions, validation and demo-mode restrictions of the REST API --
 * there is no second implementation of any of it to keep in sync.
 */
export default async function mcpRoutes(app: FastifyInstance) {
  function buildServer(authorization: string): McpServer {
    async function call(method: "GET" | "POST", url: string, payload?: unknown) {
      const res = await app.inject({
        method,
        url,
        headers: {
          authorization,
          ...(payload !== undefined ? { "content-type": "application/json" } : {}),
        },
        payload: payload !== undefined ? JSON.stringify(payload) : undefined,
      });
      const text = res.body || "{}";
      const result: ToolResult = { content: [{ type: "text", text }] };
      if (res.statusCode >= 400) {
        result.isError = true;
        result.content = [{ type: "text", text: `HTTP ${res.statusCode}: ${text}` }];
      }
      return result;
    }

    const server = new McpServer({ name: "dripline", version: "1.0.0" });
    const readOnly = { readOnlyHint: true };
    const id = z.number().int().describe("Numeric id");

    server.registerTool(
      "list_lists",
      {
        title: "List mailing lists",
        description: "All lists with subscriber and unsubscribed counts.",
        annotations: readOnly,
      },
      () => call("GET", "/api/v1/lists"),
    );

    server.registerTool(
      "list_subscribers",
      {
        title: "Search subscribers",
        description: "Paged subscriber search. Returns { subscribers, total }.",
        inputSchema: {
          q: z.string().optional().describe("Substring match on email or name"),
          email: z.string().optional().describe("Exact email match"),
          list_ids: z.array(z.number().int()).optional().describe("Only members of these lists"),
          tags: z.array(z.string()).optional(),
          limit: z.number().int().min(1).max(200).optional().describe("Default 50"),
          offset: z.number().int().min(0).optional(),
        },
        annotations: readOnly,
      },
      ({ list_ids, tags, ...rest }) =>
        call(
          "GET",
          `/api/v1/subscribers${query({ ...rest, list_ids: list_ids?.join(","), tags: tags?.join(",") })}`,
        ),
    );

    server.registerTool(
      "get_subscriber",
      {
        title: "Get a subscriber",
        description: "One subscriber with their list memberships.",
        inputSchema: { id },
        annotations: readOnly,
      },
      ({ id }) => call("GET", `/api/v1/subscribers/${id}`),
    );

    server.registerTool(
      "list_campaigns",
      {
        title: "List campaigns",
        description: "All campaigns with live sent / to_send counts.",
        annotations: readOnly,
      },
      () => call("GET", "/api/v1/campaigns"),
    );

    server.registerTool(
      "get_campaign",
      {
        title: "Get a campaign",
        description: "One campaign, including its body and attached lists.",
        inputSchema: { id },
        annotations: readOnly,
      },
      ({ id }) => call("GET", `/api/v1/campaigns/${id}`),
    );

    server.registerTool(
      "get_campaign_analytics",
      {
        title: "Campaign analytics",
        description: "Sent, opens, unique opens, clicks and per-link activity for a campaign.",
        inputSchema: { id },
        annotations: readOnly,
      },
      ({ id }) => call("GET", `/api/v1/campaigns/${id}/analytics`),
    );

    server.registerTool(
      "list_templates",
      {
        title: "List email templates",
        description: "Templates a campaign can be wrapped in.",
        annotations: readOnly,
      },
      () => call("GET", "/api/v1/templates"),
    );

    server.registerTool(
      "list_connections",
      {
        title: "List sending connections",
        description: "SMTP / SES connections (secrets masked). Needed for connection_ids.",
        annotations: readOnly,
      },
      () => call("GET", "/api/v1/connections"),
    );

    server.registerTool(
      "list_automations",
      {
        title: "List automations",
        description: "All automations with their status and trigger.",
        annotations: readOnly,
      },
      () => call("GET", "/api/v1/automations"),
    );

    server.registerTool(
      "create_list",
      {
        title: "Create a list",
        description: "Create a mailing list.",
        inputSchema: {
          name: z.string().min(1),
          type: z.enum(["public", "private"]).optional(),
          optin: z.enum(["single", "double"]).optional(),
          description: z.string().optional(),
        },
      },
      (args) => call("POST", "/api/v1/lists", args),
    );

    server.registerTool(
      "add_subscriber",
      {
        title: "Add or update a subscriber",
        description:
          "Upserts by email and optionally subscribes them to lists. Set preconfirm to skip double opt-in.",
        inputSchema: {
          email: z.string().email(),
          name: z.string().optional(),
          attribs: z.record(z.string(), z.unknown()).optional(),
          list_ids: z.array(z.number().int()).optional(),
          preconfirm: z.boolean().optional(),
        },
      },
      (args) => call("POST", "/api/v1/subscribers", args),
    );

    server.registerTool(
      "create_campaign",
      {
        title: "Create a draft campaign",
        description:
          "Creates a draft only; nothing is sent until start_campaign. body is HTML and may use merge fields such as {{Subscriber.Name}}.",
        inputSchema: {
          name: z.string().min(1),
          subject: z.string().min(1),
          body: z.string(),
          preheader: z.string().optional(),
          from_email: z.string().email().optional(),
          from_name: z.string().optional(),
          reply_to: z.string().email().optional(),
          template_id: z.number().int().optional(),
          list_ids: z.array(z.number().int()).optional(),
          connection_ids: z.array(z.number().int()).optional(),
        },
      },
      (args) => call("POST", "/api/v1/campaigns", { ...args, content_type: "html" }),
    );

    server.registerTool(
      "send_test_email",
      {
        title: "Send a campaign test email",
        description: "Sends one test copy of a campaign to a single address.",
        inputSchema: { id, email: z.string().email() },
      },
      ({ id, email }) => call("POST", `/api/v1/campaigns/${id}/test`, { email }),
    );

    server.registerTool(
      "start_campaign",
      {
        title: "Start sending a campaign",
        description:
          "Begins delivery to every subscribed member of the campaign's lists. Irreversible for mail already sent; confirm with the user first.",
        inputSchema: { id },
        annotations: { destructiveHint: true },
      },
      ({ id }) => call("POST", `/api/v1/campaigns/${id}/start`),
    );

    server.registerTool(
      "pause_campaign",
      {
        title: "Pause a running campaign",
        description: "Stops further delivery; can be resumed with start_campaign.",
        inputSchema: { id },
      },
      ({ id }) => call("POST", `/api/v1/campaigns/${id}/pause`),
    );

    return server;
  }

  app.post("/mcp", { preHandler: app.requireAuth }, async (req, reply) => {
    const server = buildServer(req.headers.authorization ?? "");
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  // Stateless: there is no server-initiated stream or session to resume.
  const notAllowed = async (_req: unknown, reply: import("fastify").FastifyReply) =>
    reply.code(405).header("allow", "POST").send({ error: "use POST" });
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
