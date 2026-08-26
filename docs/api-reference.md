# API reference

Base path: `/api/v1`. All endpoints except `/meta`, `/auth/login`, `/auth/setup`,
and `/track/*` / `/unsubscribe/*` require an `Authorization: Bearer <token>`
header -- either an admin session JWT (from `/auth/login`) or an API key
(from **Settings → API keys** in the admin UI, format `dk_xxx_xxx`).

Request/response bodies are JSON. Validation errors return `400` with
`{ "error": "validation failed", "issues": [...] }` (Zod issue format).

## Instance

| Method | Path    | Notes                                                                                       |
| ------ | ------- | ------------------------------------------------------------------------------------------- |
| GET    | `/meta` | Public. `{ version, source_url, license }` -- the AGPL section 13 source offer the UI links |

`/health` (outside `/api/v1`) returns `{ status: "ok" }` after a database
round-trip, and is what the container healthcheck polls.

## Auth

| Method | Path            | Notes                                                     |
| ------ | --------------- | --------------------------------------------------------- |
| POST   | `/auth/setup`   | Creates the first admin user. Fails once any user exists. |
| POST   | `/auth/login`   | `{ email, password }` → `{ token, user }`                 |
| GET    | `/auth/me`      | Current admin user (JWT only)                             |
| GET    | `/api-keys`     | List API keys                                             |
| POST   | `/api-keys`     | `{ name }` → includes plaintext `key` once                |
| DELETE | `/api-keys/:id` | Revoke a key                                              |

## Subscribers

| Method | Path                                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/subscribers?q=&list_id=&limit=&offset=` | Returns `{ subscribers: Subscriber[], total: number }` — `total` is the count of rows matching the current `q`/`list_id` filter (ignoring `limit`/`offset`), for pagination and "select all matching"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| GET    | `/subscribers/:id`                        | Includes list memberships                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| POST   | `/subscribers`                            | `{ email, name?, status?, attribs?, list_ids?, preconfirm? }` -- upserts by email. `status` is `enabled \| blocklisted` (default `enabled`). `preconfirm` marks the given `list_ids` as confirmed immediately instead of the opt-in-type default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| PATCH  | `/subscribers/:id`                        | `{ name?, attribs? }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| DELETE | `/subscribers/:id`                        | Hard delete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| POST   | `/subscribers/:id/blocklist`              | Blocklists + unsubscribes from all lists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| POST   | `/subscribers/:id/unblocklist`            | Reverses blocklisting; restores each list membership's status to whatever it was right before blocklisting force-unsubscribed it (tracked via `subscriber_lists.pre_blocklist_status`) -- a membership already unsubscribed before blocklisting stays unsubscribed                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| PUT    | `/subscribers/:id/lists/:listId`          | `{ status? }` add/update list membership                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| DELETE | `/subscribers/:id/lists/:listId`          | Marks membership unsubscribed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| PUT    | `/subscribers/:id/tags/:tag`              | Adds a tag                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| DELETE | `/subscribers/:id/tags/:tag`              | Removes a tag                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| POST   | `/subscribers/import`                     | `{ mode?, status?, list_ids?, overwrite_user_info?, overwrite_subscription_status?, subscribers: [{ email, name?, attribs? }] }` bulk upsert. `mode` is `subscribe \| blocklist` (default `subscribe`); in blocklist mode `list_ids` is ignored. `status` (`unconfirmed \| confirmed`, default `confirmed`) is the list-membership status applied to every list in `list_ids`. The two `overwrite_*` flags (both default `false`) control whether an existing subscriber's/membership's data gets clobbered by the import vs. left alone. The admin UI's import page does CSV parsing and column→field mapping client-side and posts the resulting `subscribers` array in batches -- there's no server-side CSV/file upload endpoint. |
| POST   | `/subscribers/bulk/blocklist`             | `{ ids: number[] } \| { query: { q?, list_id? }, all: true }` — bulk blocklist. Returns `{ affected }`. Single SQL statement, not a per-row loop. `pre_blocklist_status` is stashed so individual `unblocklist` can still restore later.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| POST   | `/subscribers/bulk/delete`                | Same selector shape — bulk hard delete (cascades to subscriber_lists, campaign_emails, bounces, etc.). Returns `{ affected }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| POST   | `/subscribers/bulk/lists`                 | `BulkSelector & { list_ids: number[], action: "add" \| "remove", status?: "unconfirmed" \| "confirmed", trigger_automations?: boolean }` — bulk list management. `status` required when `action === "add"`. "Remove" = soft-unsubscribe (same as single-subscriber `removeFromList`). `trigger_automations` (default `false`) decides whether the affected contacts are enrolled in `list_applied`/`list_removed` automations — off by default so one bulk change can't enrol thousands of people by accident. Returns `{ affected }`.                                                                                                                                                                                                |
| POST   | `/subscribers/export`                     | `BulkSelector` — returns `text/csv` with `Content-Disposition: attachment`. Columns: `email,name,status,attribs,lists` (attribs as JSON string, lists as `name:status` semicolon-separated). Export re-imports cleanly through the CSV import flow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Lists / Templates / Connections

Standard CRUD under `/lists`, `/templates`, `/connections` -- see the route
source (`apps/api/src/routes/*.ts`) for exact field shapes; the admin UI
covers all of these forms. Connection `config.password`/`config.secret_access_key`
are never returned in full (masked) once saved.

Sender identity is layered: a connection's `from_email`/`from_name` is the
authorized sending identity, and a campaign may override either. A campaign
`from_name` on its own re-labels the connection's own address, while a campaign
`from_email` replaces the address and drops the connection's display name (it
may belong to a different identity). Display names needing RFC 5322 quoting
(commas, quotes) are quoted automatically.

`reply_to` exists on both `connections` (default for everything it sends) and
`campaigns` (overrides it for one send); unset on both means no `Reply-To`
header at all.

`connections` also has `list_unsubscribe_header` (boolean, default `true`):
when on, every email sent through that connection gets `List-Unsubscribe`
and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers pointing at
the same signed unsubscribe link embedded in the body -- improves inbox
placement and is what Gmail/Yahoo's 2024 bulk-sender rules expect. It's
per-connection rather than global since connections model distinct sending
domains/identities. No `mailto:` form is offered (would need a mailbox
that actually processes unsubscribe requests, which this project doesn't
have).

### Bounce mailbox scanning

Per connection, optional IMAP mailbox scanning for bounces (a second,
independent ingestion path alongside the webhook-based `POST /bounces` --
see `docs/plan/mailbox_bounce_scanning.md`). `connections.bounce_config`:

```ts
{
  enabled: boolean;
  host: string; // IMAP host -- always required when enabled
  port: number; // IMAP host/port are never derived from the
  tls: boolean; // sending config, even with use_sending_credentials
  username: string; // IMAP login -- required unless use_sending_credentials
  password: string; // required unless use_sending_credentials
  email: string; // address bounces route to -- distinct from
  // username (an IMAP login isn't always an email
  // address); required unless use_sending_credentials
  use_sending_credentials: boolean; // reuse this connection's own SMTP login (smtp type only)
  folder: string; // default "INBOX"
  max_age_days: number; // default 7 -- hard bound on every scan's IMAP SEARCH
  max_messages_per_scan: number; // default 200
}
```

`bounce_config.password` is masked the same way `config.password` is.
Runs every 5 minutes for every `enabled` connection with `bounce_config.
enabled: true`; never marks messages read, moves, or deletes anything --
tracks progress via `connections.bounce_last_uid`/`bounce_last_uidvalidity`
(not user-editable). `POST /connections/:id/bounce-test` and
`POST /connections/bounce-test` (unsaved draft) check reachability only,
same as the existing `/test` endpoints for sending config.

A separate bounce mailbox (`use_sending_credentials: false`) also makes
outgoing sends through that connection carry an envelope-from (Return-Path)
override pointing at `bounce_config.email`, so DSNs actually route there --
not guaranteed to be honored by every SMTP provider.

`POST /templates/preview` -- `{ body }` → `{ html }`. Renders the given
(possibly unsaved) template body with sample content standing in for
`{{ Body }}`, so a template can be previewed on its own without a real
campaign.

## Campaigns

| Method | Path                         | Notes                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/campaigns`                 | List                                                                                                                                                                                                                                                                                                                                                                  |
| GET    | `/campaigns/:id`             | Includes attached `lists`, `connections` (ordered by priority), live `progress`                                                                                                                                                                                                                                                                                       |
| POST   | `/campaigns`                 | `{ name, subject, body, body_source?, content_type?, from_email?, from_name?, reply_to?, template_id?, list_ids, connection_ids, send_at?, rate_limit_count?, rate_limit_duration_seconds? }`. `content_type` one of `richtext \| html \| plain \| markdown \| visual` (default `richtext`). Rate limit fields must be set together or both omitted.                  |
| PATCH  | `/campaigns/:id`             | Partial update (draft/scheduled/paused fields). `template_id`/`rate_limit_*`/`from_name`/`reply_to` accept explicit `null` (or `""` for the latter two) to clear.                                                                                                                                                                                                     |
| PUT    | `/campaigns/:id/lists`       | Replace attached list IDs                                                                                                                                                                                                                                                                                                                                             |
| PUT    | `/campaigns/:id/connections` | Replace the ordered connection chain (array order = priority, first is primary)                                                                                                                                                                                                                                                                                       |
| DELETE | `/campaigns/:id`             | Only while draft/scheduled                                                                                                                                                                                                                                                                                                                                            |
| POST   | `/campaigns/:id/duplicate`   | Creates a new draft with the same content, lists, and connection chain. Never copies `send_at`, `status`, or send history/analytics -- the copy always starts as a fresh, unscheduled draft.                                                                                                                                                                          |
| POST   | `/campaigns/:id/start`       | draft/scheduled/paused → running. Materializes `campaign_emails` rows.                                                                                                                                                                                                                                                                                                |
| POST   | `/campaigns/:id/pause`       | running → paused                                                                                                                                                                                                                                                                                                                                                      |
| POST   | `/campaigns/:id/cancel`      | running/paused/draft → cancelled                                                                                                                                                                                                                                                                                                                                      |
| POST   | `/campaigns/:id/test`        | `{ email, name?, subject?, body?, body_source?, content_type?, from_email?, from_name?, reply_to?, template_id? }` → `{ ok, error }`. Sends one-off, using the campaign's _saved_ connections but any overrides passed in -- doesn't persist them or touch `campaign_emails`/progress. `email` need not be an existing subscriber.                                    |
| POST   | `/campaigns/preview`         | `{ subject?, body, body_source?, content_type?, template_id? }` → `{ subject, html }`. Renders the given content the same way a real send would (template wrapper, merge fields, markdown conversion, tracking links against a synthetic subscriber) -- no saved campaign or sending connection required, so it works for a never-saved draft. Doesn't send anything. |
| GET    | `/campaigns/:id/progress`    | `{ pending, queued, sent, failed, skipped, total }` -- always live, never cached                                                                                                                                                                                                                                                                                      |
| GET    | `/campaigns/:id/analytics`   | `{ opens, unique_opens, clicks, unique_clicks }`                                                                                                                                                                                                                                                                                                                      |

## Automations

Node-graph automations -- see [plan/automations_v2.md](plan/automations_v2.md) for the
model. `graph` is `{ entry: <node id|null>, nodes: [{ id, type, title?, note?, config, next }] }`
with pointer edges, not array order.

| Method | Path                           | Notes                                                                                                                                                                                                                                                             |
| ------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/automations`                 | List, each with `enrollment_counts`                                                                                                                                                                                                                               |
| GET    | `/automations/registry`        | `{ triggers, actions }` -- the trigger/action catalogue this build supports (`type`, `label`, `description`, `group`)                                                                                                                                             |
| GET    | `/automations/:id`             | Detail, including `enrollment_counts`                                                                                                                                                                                                                             |
| POST   | `/automations`                 | `{ name, trigger_type, trigger_config? }`. Trigger defaults are filled server-side (an incoming-webhook automation gets its secret `key` here)                                                                                                                    |
| PATCH  | `/automations/:id`             | `{ name?, trigger_config?, graph?, status?, reentry_mode? }`. A saved graph is checked structurally (unique ids, edges pointing at real nodes); per-node config is only validated when `status: "published"`, so half-configured steps can be saved while editing |
| DELETE | `/automations/:id`             | Also removes the enrollments                                                                                                                                                                                                                                      |
| POST   | `/automations/:id/enroll`      | `{ subscriber_id }` manual enrollment (respects `reentry_mode` and publish state)                                                                                                                                                                                 |
| GET    | `/automations/:id/enrollments` | Recent enrollments with `current_node_id`, `next_run_at`, contact email                                                                                                                                                                                           |

Triggers: `list_applied`, `list_removed`, `contact_created`, `webhook_incoming`.
The two list triggers require at least one list in `trigger_config.list_ids` --
an empty selection neither publishes nor matches anything.
Actions: `wait`, `send_custom_email`, `apply_list`, `remove_list`.
Both are registries (`apps/api/src/automations/`) -- adding one is a single entry there
plus its UI counterpart in `apps/web/src/automations/`.

`status` is `draft | published | paused`. Only `published` automations enrol contacts;
pausing holds contacts in place rather than dropping them.

## Event ingestion

| Method | Path                      | Notes                                                                                                                                                                                                                                             |
| ------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/automations/hooks/:key` | **Unauthenticated** -- the per-automation `key` is the credential. `{ email? \| subscriber_id?, name?, attribs?, ...payload }`. Creates the contact if `email` is unknown, then enrols them in the `webhook_incoming` automation owning that key. |
| POST   | `/bounces`                | `{ email, campaign_uuid?, type: "hard"\|"soft"\|"complaint", source?, meta? }`. Auto-blocklists per threshold.                                                                                                                                    |

## Tracking (public, unauthenticated, HMAC-signed)

These URLs are generated automatically inside sent campaign emails -- you
should not need to construct them by hand.

| Method   | Path                                                           |
| -------- | -------------------------------------------------------------- |
| GET      | `/track/open/:campaignUuid/:subscriberUuid?sig=`               |
| GET      | `/track/click/:campaignUuid/:subscriberUuid?url=&sig=`         |
| GET/POST | `/unsubscribe/:campaignUuid/:subscriberUuid?sig=`              |
| GET/POST | `/unsubscribe/automation/:automationUuid/:subscriberUuid?sig=` |

The automation variant is the one-click (List-Unsubscribe) target for emails sent by an
automation. An automation isn't list-scoped the way a campaign is, so one-click there
unsubscribes the contact from every list; the visible link in the body still goes to the
per-list preference page.
