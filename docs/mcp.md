# MCP server

Dripline exposes a [Model Context Protocol](https://modelcontextprotocol.io)
endpoint so an AI client (Claude, Paperclip, Cursor, ...) can read and operate an
install directly. It is the same process and the same permissions as the REST
API -- see [api-reference.md](api-reference.md) for the underlying routes.

|           |                                                               |
| --------- | ------------------------------------------------------------- |
| Endpoint  | `POST https://<your-domain>/mcp` (outside `/api/v1`)          |
| Transport | Streamable HTTP, stateless, JSON responses (no sessions/SSE)  |
| Auth      | `Authorization: Bearer <token>` -- same as the REST API       |
| Other     | `GET` and `DELETE` return `405`; no token returns `401`       |
| Demo mode | Writes are blocked with `403` when `IS_DEMO=true` (see below) |

## Setup

1. In the admin UI go to **Settings → Roles** and create a role with only the
   permissions the client needs (see [Permissions](#permissions)).
2. Go to **Settings → Users**, add a user of type **API** with that role, and
   copy the token (`dk_xxx_xxx`). It is shown once.
3. Add the server to your client:

```json
{
  "mcpServers": {
    "dripline": {
      "type": "http",
      "url": "https://email.example.com/mcp",
      "headers": { "Authorization": "Bearer dk_xxx_xxx" }
    }
  }
}
```

Claude Code equivalent:

```bash
claude mcp add --transport http dripline https://email.example.com/mcp \
  --header "Authorization: Bearer dk_xxx_xxx"
```

Quick check without a client:

```bash
curl -s https://email.example.com/mcp \
  -H "authorization: Bearer dk_xxx_xxx" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Tools

Every tool returns the REST route's JSON as text. A failed call returns
`isError: true` with `HTTP <status>: <body>` -- for example `HTTP 404:
{"error":"subscriber not found"}`.

### Read-only

| Tool                     | Inputs                                                                        | REST route                     |
| ------------------------ | ----------------------------------------------------------------------------- | ------------------------------ |
| `list_lists`             | --                                                                            | `GET /lists`                   |
| `list_subscribers`       | `q?`, `email?`, `list_ids?`, `tags?`, `limit?` (1-200, default 50), `offset?` | `GET /subscribers`             |
| `get_subscriber`         | `id`                                                                          | `GET /subscribers/:id`         |
| `list_campaigns`         | --                                                                            | `GET /campaigns`               |
| `get_campaign`           | `id`                                                                          | `GET /campaigns/:id`           |
| `get_campaign_analytics` | `id`                                                                          | `GET /campaigns/:id/analytics` |
| `list_templates`         | --                                                                            | `GET /templates`               |
| `list_connections`       | -- (secrets masked)                                                           | `GET /connections`             |
| `list_automations`       | --                                                                            | `GET /automations`             |

`list_subscribers` returns `{ subscribers, total }`. `q` is a substring match on
email or name; `email` is an exact match.

### Write

| Tool              | Inputs                                                                                                                            | REST route                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `create_list`     | `name`, `type?` (`public`/`private`), `optin?` (`single`/`double`), `description?`                                                | `POST /lists`               |
| `add_subscriber`  | `email`, `name?`, `attribs?`, `list_ids?`, `preconfirm?`                                                                          | `POST /subscribers`         |
| `create_campaign` | `name`, `subject`, `body`, `preheader?`, `from_email?`, `from_name?`, `reply_to?`, `template_id?`, `list_ids?`, `connection_ids?` | `POST /campaigns`           |
| `send_test_email` | `id`, `email`                                                                                                                     | `POST /campaigns/:id/test`  |
| `start_campaign`  | `id`                                                                                                                              | `POST /campaigns/:id/start` |
| `pause_campaign`  | `id`                                                                                                                              | `POST /campaigns/:id/pause` |

- `add_subscriber` upserts by email. Set `preconfirm: true` to skip double
  opt-in on the lists.
- `create_campaign` only ever creates a **draft**; the body is HTML and may use
  merge fields such as `{{Subscriber.Name}}`. Nothing is sent until
  `start_campaign`.
- `start_campaign` begins delivery to every subscribed member of the campaign's
  lists and cannot recall mail already sent. It is annotated `destructiveHint`,
  so well-behaved clients ask before calling it. Use `send_test_email` first.

### Typical flow

1. `list_lists` and `list_connections` to find the list and connection ids.
2. `create_campaign` with `list_ids` and `connection_ids` set.
3. `send_test_email` to yourself, review it.
4. `start_campaign` once approved; `get_campaign_analytics` afterwards.

## Permissions

Each tool is checked against the token's role exactly as the matching REST route
is (the Super Admin role bypasses everything). A missing permission comes back
as `HTTP 403: {"error":"missing permission: ..."}`.

| Tools                                                      | Permission           |
| ---------------------------------------------------------- | -------------------- |
| `list_lists`                                               | `lists:get`          |
| `create_list`                                              | `lists:manage`       |
| `list_subscribers`, `get_subscriber`                       | `subscribers:get`    |
| `add_subscriber`                                           | `subscribers:manage` |
| `list_campaigns`, `get_campaign`, `get_campaign_analytics` | `campaigns:get`      |
| `create_campaign`, `send_test_email`                       | `campaigns:manage`   |
| `start_campaign`, `pause_campaign`                         | `campaigns:send`     |
| `list_templates`                                           | `templates:get`      |
| `list_connections`                                         | `connections:get`    |
| `list_automations`                                         | `automations:get`    |

Give a read-only assistant a role with only the `:get` permissions. Because the
token can send mail, keep it out of source control and rotate it by deleting and
recreating the API user.

## How it works

`apps/api/src/routes/mcp.ts` builds a fresh MCP server per request and registers
each tool as a thin wrapper that replays the caller's own bearer token against
the matching REST route in-process (`app.inject`). There is no second
implementation of validation, permissions or business logic, so MCP behaves
identically to the REST API and cannot do anything it can't. To add a tool,
register it there pointing at an existing route.

## Demo mode

With `IS_DEMO=true`, every authenticated write is rejected -- including those
made through `/mcp`, so the write tools return
`HTTP 403: {"error":"Add/edit is disabled in demo mode","code":"DEMO_MODE"}`.
`/mcp` itself is not exempted, so the read tools are blocked too: the endpoint
is a `POST`, and the demo gate only lets through a fixed list of read-only
`POST` routes. Don't point a client at a demo instance.
