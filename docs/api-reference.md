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

| Method | Path                                      | Notes                                                                     |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------- |
| GET    | `/subscribers?q=&list_id=&limit=&offset=` | Search/list                                                               |
| GET    | `/subscribers/:id`                        | Includes list memberships                                                 |
| POST   | `/subscribers`                            | `{ email, name?, attribs?, list_ids? }` -- upserts by email               |
| PATCH  | `/subscribers/:id`                        | `{ name?, attribs? }`                                                     |
| DELETE | `/subscribers/:id`                        | Hard delete                                                               |
| POST   | `/subscribers/:id/blocklist`              | Blocklists + unsubscribes from all lists                                  |
| PUT    | `/subscribers/:id/lists/:listId`          | `{ status? }` add/update list membership                                  |
| DELETE | `/subscribers/:id/lists/:listId`          | Marks membership unsubscribed                                             |
| PUT    | `/subscribers/:id/tags/:tag`              | Adds a tag (also fires `tag_applied` workflow triggers)                   |
| DELETE | `/subscribers/:id/tags/:tag`              | Removes a tag                                                             |
| POST   | `/subscribers/import`                     | `{ list_ids: [], subscribers: [{ email, name?, attribs? }] }` bulk upsert |

## Lists / Templates / Providers

Standard CRUD under `/lists`, `/templates`, `/providers` -- see the route
source (`apps/api/src/routes/*.ts`) for exact field shapes; the admin UI
covers all of these forms. Provider `config.password` is never returned in
full (masked) once saved.

## Campaigns

| Method | Path                       | Notes                                                                                          |
| ------ | -------------------------- | ---------------------------------------------------------------------------------------------- |
| GET    | `/campaigns`               | List                                                                                           |
| GET    | `/campaigns/:id`           | Includes attached lists + live `progress`                                                      |
| POST   | `/campaigns`               | `{ name, subject, body, from_email?, template_id?, list_ids, send_at?, messages_per_minute? }` |
| PATCH  | `/campaigns/:id`           | Partial update (draft/scheduled fields)                                                        |
| PUT    | `/campaigns/:id/lists`     | Replace attached list IDs                                                                      |
| DELETE | `/campaigns/:id`           | Only while draft/scheduled                                                                     |
| POST   | `/campaigns/:id/start`     | draft/scheduled/paused → running. Materializes `campaign_emails` rows.                         |
| POST   | `/campaigns/:id/pause`     | running → paused                                                                               |
| POST   | `/campaigns/:id/cancel`    | running/paused/draft → cancelled                                                               |
| GET    | `/campaigns/:id/progress`  | `{ pending, queued, sent, failed, skipped, total }` -- always live, never cached               |
| GET    | `/campaigns/:id/analytics` | `{ opens, unique_opens, clicks, unique_clicks }`                                               |

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
