# API reference

Base path: `/api/v1`. All endpoints except `/auth/login`, `/auth/setup`, and
`/track/*` / `/unsubscribe/*` require an `Authorization: Bearer <token>`
header -- either an admin session JWT (from `/auth/login`) or an API key
(from **Settings → API keys** in the admin UI, format `dk_xxx_xxx`).

Request/response bodies are JSON. Validation errors return `400` with
`{ "error": "validation failed", "issues": [...] }` (Zod issue format).

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
| GET    | `/subscribers?q=&list_id=&limit=&offset=` | Search/list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| GET    | `/subscribers/:id`                        | Includes list memberships                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| POST   | `/subscribers`                            | `{ email, name?, status?, attribs?, list_ids?, preconfirm? }` -- upserts by email. `status` is `enabled \| blocklisted` (default `enabled`). `preconfirm` marks the given `list_ids` as confirmed immediately instead of the opt-in-type default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| PATCH  | `/subscribers/:id`                        | `{ name?, attribs? }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| DELETE | `/subscribers/:id`                        | Hard delete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| POST   | `/subscribers/:id/blocklist`              | Blocklists + unsubscribes from all lists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| POST   | `/subscribers/:id/unblocklist`            | Reverses blocklisting; list memberships stay unsubscribed (not auto-restored)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| PUT    | `/subscribers/:id/lists/:listId`          | `{ status? }` add/update list membership                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| DELETE | `/subscribers/:id/lists/:listId`          | Marks membership unsubscribed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| PUT    | `/subscribers/:id/tags/:tag`              | Adds a tag (also fires `tag_applied` workflow triggers)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| DELETE | `/subscribers/:id/tags/:tag`              | Removes a tag                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| POST   | `/subscribers/import`                     | `{ mode?, status?, list_ids?, overwrite_user_info?, overwrite_subscription_status?, subscribers: [{ email, name?, attribs? }] }` bulk upsert. `mode` is `subscribe \| blocklist` (default `subscribe`); in blocklist mode `list_ids` is ignored. `status` (`unconfirmed \| confirmed`, default `confirmed`) is the list-membership status applied to every list in `list_ids`. The two `overwrite_*` flags (both default `false`) control whether an existing subscriber's/membership's data gets clobbered by the import vs. left alone. The admin UI's import page does CSV parsing and column→field mapping client-side and posts the resulting `subscribers` array in batches -- there's no server-side CSV/file upload endpoint. |

## Lists / Templates / Connections

Standard CRUD under `/lists`, `/templates`, `/connections` -- see the route
source (`apps/api/src/routes/*.ts`) for exact field shapes; the admin UI
covers all of these forms. Connection `config.password`/`config.secret_access_key`
are never returned in full (masked) once saved.

`connections` also has `list_unsubscribe_header` (boolean, default `true`):
when on, every email sent through that connection gets `List-Unsubscribe`
and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers pointing at
the same signed unsubscribe link embedded in the body -- improves inbox
placement and is what Gmail/Yahoo's 2024 bulk-sender rules expect. It's
per-connection rather than global since connections model distinct sending
domains/identities. No `mailto:` form is offered (would need a mailbox
that actually processes unsubscribe requests, which this project doesn't
have).

`POST /templates/preview` -- `{ body }` → `{ html }`. Renders the given
(possibly unsaved) template body with sample content standing in for
`{{ Body }}`, so a template can be previewed on its own without a real
campaign.

## Campaigns

| Method | Path                         | Notes                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/campaigns`                 | List                                                                                                                                                                                                                                                                                                                                                                  |
| GET    | `/campaigns/:id`             | Includes attached `lists`, `connections` (ordered by priority), live `progress`                                                                                                                                                                                                                                                                                       |
| POST   | `/campaigns`                 | `{ name, subject, body, body_source?, content_type?, from_email?, template_id?, list_ids, connection_ids, send_at?, rate_limit_count?, rate_limit_duration_seconds? }`. `content_type` one of `richtext \| html \| plain \| markdown \| visual` (default `richtext`). Rate limit fields must be set together or both omitted.                                         |
| PATCH  | `/campaigns/:id`             | Partial update (draft/scheduled/paused fields). `template_id`/`rate_limit_*` accept explicit `null` to clear.                                                                                                                                                                                                                                                         |
| PUT    | `/campaigns/:id/lists`       | Replace attached list IDs                                                                                                                                                                                                                                                                                                                                             |
| PUT    | `/campaigns/:id/connections` | Replace the ordered connection chain (array order = priority, first is primary)                                                                                                                                                                                                                                                                                       |
| DELETE | `/campaigns/:id`             | Only while draft/scheduled                                                                                                                                                                                                                                                                                                                                            |
| POST   | `/campaigns/:id/start`       | draft/scheduled/paused → running. Materializes `campaign_emails` rows.                                                                                                                                                                                                                                                                                                |
| POST   | `/campaigns/:id/pause`       | running → paused                                                                                                                                                                                                                                                                                                                                                      |
| POST   | `/campaigns/:id/cancel`      | running/paused/draft → cancelled                                                                                                                                                                                                                                                                                                                                      |
| POST   | `/campaigns/:id/test`        | `{ email, name?, subject?, body?, body_source?, content_type?, from_email?, template_id? }` → `{ ok, error }`. Sends one-off, using the campaign's _saved_ connections but any overrides passed in -- doesn't persist them or touch `campaign_emails`/progress. `email` need not be an existing subscriber.                                                           |
| POST   | `/campaigns/preview`         | `{ subject?, body, body_source?, content_type?, template_id? }` → `{ subject, html }`. Renders the given content the same way a real send would (template wrapper, merge fields, markdown conversion, tracking links against a synthetic subscriber) -- no saved campaign or sending connection required, so it works for a never-saved draft. Doesn't send anything. |
| GET    | `/campaigns/:id/progress`    | `{ pending, queued, sent, failed, skipped, total }` -- always live, never cached                                                                                                                                                                                                                                                                                      |
| GET    | `/campaigns/:id/analytics`   | `{ opens, unique_opens, clicks, unique_clicks }`                                                                                                                                                                                                                                                                                                                      |

## Workflows (automations)

| Method | Path                            | Notes                                                             |
| ------ | ------------------------------- | ----------------------------------------------------------------- |
| GET    | `/workflows` / `/workflows/:id` | List / detail (detail includes enrollment counts)                 |
| POST   | `/workflows`                    | `{ name, trigger_type, trigger_config, steps, reentry_allowed? }` |
| PATCH  | `/workflows/:id`                | Also used to set `status: "active" \| "paused" \| "draft"`        |
| DELETE | `/workflows/:id`                |                                                                   |
| POST   | `/workflows/:id/enroll`         | `{ subscriber_id }` manual enrollment                             |
| GET    | `/workflows/:id/enrollments`    | Recent enrollments + current step                                 |

Step types (see `apps/api/src/lib/workflowSteps.ts` for the exact schema):
`delay`, `send_email`, `add_tag`, `remove_tag`, `add_list`, `remove_list`,
`condition`, `webhook_out`.

## Event ingestion

| Method | Path                  | Notes                                                                                                                                       |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/webhooks/:eventKey` | `{ email? \| subscriber_id?, ...payload }`. Matches active `webhook`-trigger workflows whose `trigger_config.event_key` equals `:eventKey`. |
| POST   | `/bounces`            | `{ email, campaign_uuid?, type: "hard"\|"soft"\|"complaint", source?, meta? }`. Auto-blocklists per threshold.                              |

## Tracking (public, unauthenticated, HMAC-signed)

These URLs are generated automatically inside sent campaign emails -- you
should not need to construct them by hand.

| Method   | Path                                                   |
| -------- | ------------------------------------------------------ |
| GET      | `/track/open/:campaignUuid/:subscriberUuid?sig=`       |
| GET      | `/track/click/:campaignUuid/:subscriberUuid?url=&sig=` |
| GET/POST | `/unsubscribe/:campaignUuid/:subscriberUuid?sig=`      |
