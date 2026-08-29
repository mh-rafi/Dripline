# API reference

Base path: `/api/v1`. All endpoints except `/meta`, `/auth/login`, `/auth/setup`,
`/auth/forgot-password`, `/auth/reset-password`, `/automations/hooks/:key`, and
`/track/*` / `/unsubscribe/*` require an
`Authorization: Bearer <token>` header -- either an admin session JWT (from
`/auth/login`) or an API user's token (format `dk_xxx_xxx`, created under
**Settings → Users** in the admin UI, type `api`).

Every user (both types) has a **role** -- a named set of granular
`resource:verb` permissions (e.g. `campaigns:manage`), managed under
**Settings → Roles**. A request whose token belongs to a user missing the
permission a route requires gets `403 { "error": "missing permission: ..." }`.
The built-in Super Admin role (id `1`) bypasses every check.

Request/response bodies are JSON. Validation errors return `400` with
`{ "error": "validation failed", "issues": [...] }` (Zod issue format).

## Instance

| Method | Path    | Notes                                                                                       |
| ------ | ------- | ------------------------------------------------------------------------------------------- |
| GET    | `/meta` | Public. `{ version, source_url, license }` -- the AGPL section 13 source offer the UI links |

`/health` (outside `/api/v1`) returns `{ status: "ok" }` after a database
round-trip, and is what the container healthcheck polls.

## Auth

| Method | Path          | Notes                                                                        |
| ------ | ------------- | ---------------------------------------------------------------------------- |
| POST   | `/auth/setup` | Creates the first user, always as Super Admin. Fails once any user exists.   |
| POST   | `/auth/login` | `{ email, password }` → `{ token, user }`. `type: "api"` users can't log in. |
| GET    | `/auth/me`    | Current user's profile (JWT or API token)                                    |

`GET /meta` also reports `setup_required` (true only while no user exists at
all), which is what the login page uses to decide whether to offer the
first-run setup form.

### Password management

A password change bumps `users.password_changed_at`, and any JWT issued before
that instant is refused with `401 { "error": "password changed -- sign in
again" }`. That is what makes a reset actually evict a stolen session instead
of leaving it valid for the rest of its 30 days -- so a client holding an old
token must sign in again, and a client that just changed its own password must
store the replacement token it gets back.

| Method | Path                    | Notes                                                                                                                                                                                                                                                                                                                                                                                           |
| ------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/password`        | `{ current_password, new_password }` → `{ token }`. Changes **your own** password; needs a signed-in JWT session and no particular permission (an API-key request is refused). Wrong `current_password` returns `401`. Editing someone else's password stays on `PATCH /users/:id` behind `users:manage`.                                                                                       |
| POST   | `/auth/forgot-password` | `{ email }` → `{ ok: true }`, unauthenticated. Always returns the same response so it can't be used to discover which addresses have accounts -- an unknown address, a disabled account, an unconfigured system connection and a provider failure are all indistinguishable to the caller. At most one mail per account per 60 seconds; issuing a link invalidates any earlier outstanding one. |
| POST   | `/auth/reset-password`  | `{ token, password }` → `{ ok: true }`, unauthenticated. The token comes from the emailed link, is single-use, and expires an hour after it was issued. Consuming it deletes every reset token for that account and signs out that account's other sessions. Does **not** return a session -- the client sends the person back to `/auth/login`.                                                |

Reset tokens are stored only as a SHA-256 hash, so the plaintext exists solely
in the emailed link. The mail goes out over the connection chosen in
**Settings → System** -- with none chosen, reset email is off and an admin has
to change the password from the Users tab instead.

## Users & roles

Requires `users:get`/`users:manage` and `roles:get`/`roles:manage`
respectively. Deleting or demoting the instance's last enabled Super Admin is
rejected with `409` to prevent a lockout.

| Method | Path                          | Notes                                                                                                                                                               |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/users`                      | List users (both types)                                                                                                                                             |
| GET    | `/users/:id`                  | Single user                                                                                                                                                         |
| POST   | `/users`                      | `{ type: "user", name, email, password, role_id, status? }` or `{ type: "api", name, role_id, status? }`. An `api` user's response includes plaintext `token` once. |
| PATCH  | `/users/:id`                  | Same shape as create, all fields optional; blank/omitted `password` leaves it unchanged. `email`/`password` aren't accepted for `api` users.                        |
| POST   | `/users/:id/regenerate-token` | `api` users only -- issues a new token, invalidating the old one immediately, returned once as `token`.                                                             |
| DELETE | `/users/:id`                  | —                                                                                                                                                                   |
| GET    | `/roles`                      | List roles                                                                                                                                                          |
| GET    | `/roles/permissions`          | The full list of valid permission strings                                                                                                                           |
| GET    | `/roles/:id`                  | Single role                                                                                                                                                         |
| POST   | `/roles`                      | `{ name, permissions: string[] }`                                                                                                                                   |
| PATCH  | `/roles/:id`                  | Same shape, optional fields. The Super Admin role (id `1`) can't be edited.                                                                                         |
| DELETE | `/roles/:id`                  | The Super Admin role can't be deleted; a role still assigned to a user returns `409`.                                                                               |

## Subscribers

| Method | Path                                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/subscribers?q=&list_id=&limit=&offset=` | Returns `{ subscribers: Subscriber[], total: number }` — `total` is the count of rows matching the current `q`/`list_id` filter (ignoring `limit`/`offset`), for pagination and "select all matching"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| GET    | `/subscribers/:id`                        | Includes list memberships                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| POST   | `/subscribers`                            | `{ email, name?, status?, attribs?, list_ids?, preconfirm? }` -- upserts by email. `status` is `enabled \| blocklisted` (default `enabled`). `preconfirm` marks the given `list_ids` as confirmed immediately instead of the opt-in-type default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| PATCH  | `/subscribers/:id`                        | `{ name?, attribs? }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| DELETE | `/subscribers/:id`                        | Hard delete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| POST   | `/subscribers/:id/blocklist`              | Blocklists + unsubscribes from all lists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| POST   | `/subscribers/:id/unblocklist`            | Reverses blocklisting; restores each list membership's status to whatever it was right before blocklisting force-unsubscribed it (tracked via `subscriber_lists.pre_blocklist_status`) -- a membership already unsubscribed before blocklisting stays unsubscribed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| PUT    | `/subscribers/:id/lists/:listId`          | `{ status? }` add/update list membership                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| DELETE | `/subscribers/:id/lists/:listId`          | Marks membership unsubscribed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| PUT    | `/subscribers/:id/tags/:tag`              | Adds a tag                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| DELETE | `/subscribers/:id/tags/:tag`              | Removes a tag                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| POST   | `/subscribers/import`                     | `{ mode?, status?, list_ids?, overwrite_user_info?, overwrite_subscription_status?, attribs_mode?, subscribers: [{ email, name?, attribs? }] }` bulk upsert. `mode` is `subscribe \| blocklist` (default `subscribe`); in blocklist mode `list_ids` is ignored. `status` (`unconfirmed \| confirmed`, default `confirmed`) is the list-membership status applied to every list in `list_ids`. The two `overwrite_*` flags (both default `false`) control whether an existing subscriber's name / membership status gets clobbered by the import vs. left alone. `attribs_mode` (`merge \| replace \| skip`, default `merge`) governs an existing subscriber's `attribs` independently of `overwrite_user_info`: `merge` is a shallow top-level JSONB merge (`attribs |     | incoming`) so imported keys are added/updated and everything else survives, `replace`swaps the whole object (this discards`tags`, which live in `attribs`), `skip`leaves it untouched. The admin UI's import page does CSV parsing and column→field mapping client-side and posts the resulting`subscribers` array in batches -- there's no server-side CSV/file upload endpoint. |
| POST   | `/subscribers/bulk/blocklist`             | `{ ids: number[] } \| { query: { q?, list_id? }, all: true }` — bulk blocklist. Returns `{ affected }`. Single SQL statement, not a per-row loop. `pre_blocklist_status` is stashed so individual `unblocklist` can still restore later.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| POST   | `/subscribers/bulk/delete`                | Same selector shape — bulk hard delete (cascades to subscriber_lists, campaign_emails, bounces, etc.). Returns `{ affected }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| POST   | `/subscribers/bulk/lists`                 | `BulkSelector & { list_ids: number[], action: "add" \| "remove", status?: "unconfirmed" \| "confirmed", trigger_automations?: boolean }` — bulk list management. `status` required when `action === "add"`. "Remove" = soft-unsubscribe (same as single-subscriber `removeFromList`). `trigger_automations` (default `false`) decides whether the affected contacts are enrolled in `list_applied`/`list_removed` automations — off by default so one bulk change can't enrol thousands of people by accident. Returns `{ affected }`.                                                                                                                                                                                                                               |
| POST   | `/subscribers/export`                     | `BulkSelector` — returns `text/csv` with `Content-Disposition: attachment`. Columns: `email,name,status,attribs,lists` (attribs as JSON string, lists as `name:status` semicolon-separated). Export re-imports cleanly through the CSV import flow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

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

Both `:id` test endpoints accept an optional body of unsaved edits --
`{ type?, config? }` for `/test`, plus `bounce_config?` for `/bounce-test` --
merged onto the stored row before testing, so the admin UI can test what is
on screen without saving first. Omitted secrets fall back to the stored ones
under the same "empty means keep" rule as `PATCH`, which is what makes this
usable at all: the UI blanks a masked password field, so the draft it sends
never carries the real credential. Sending an empty body tests the saved row
exactly as before. Neither endpoint writes anything, and neither disturbs the
pooled sender that real sends use.

A separate bounce mailbox (`use_sending_credentials: false`) also makes
outgoing sends through that connection carry an envelope-from (Return-Path)
override pointing at `bounce_config.email`, so DSNs actually route there --
not guaranteed to be honored by every SMTP provider.

`POST /templates/preview` -- `{ body }` → `{ html }`. Renders the given
(possibly unsaved) template body with sample content standing in for
`{{ Body }}`, so a template can be previewed on its own without a real
campaign.

## Campaigns

| Method | Path                          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/campaigns`                  | List                                                                                                                                                                                                                                                                                                                                                                                                                         |
| GET    | `/campaigns/:id`              | Includes attached `lists`, `connections` (ordered by priority), live `progress`                                                                                                                                                                                                                                                                                                                                              |
| POST   | `/campaigns`                  | `{ name, subject, preheader?, body, body_source?, content_type?, from_email?, from_name?, reply_to?, template_id?, list_ids, connection_ids, send_at?, rate_limit_count?, rate_limit_duration_seconds? }`. `content_type` one of `richtext \| html \| plain \| markdown \| visual` (default `richtext`). Rate limit fields must be set together or both omitted. `preheader` is the inbox-preview snippet -- see note below. |
| PATCH  | `/campaigns/:id`              | Partial update (draft/scheduled/paused fields). `template_id`/`rate_limit_*`/`from_name`/`reply_to`/`preheader` accept explicit `null` (or `""` for the latter three) to clear.                                                                                                                                                                                                                                              |
| PUT    | `/campaigns/:id/lists`        | Replace attached list IDs                                                                                                                                                                                                                                                                                                                                                                                                    |
| PUT    | `/campaigns/:id/connections`  | Replace the ordered connection chain (array order = priority, first is primary)                                                                                                                                                                                                                                                                                                                                              |
| DELETE | `/campaigns/:id`              | Only while draft/scheduled                                                                                                                                                                                                                                                                                                                                                                                                   |
| POST   | `/campaigns/:id/duplicate`    | Creates a new draft with the same content, lists, and connection chain. Never copies `send_at`, `status`, or send history/analytics -- the copy always starts as a fresh, unscheduled draft.                                                                                                                                                                                                                                 |
| POST   | `/campaigns/:id/start`        | draft/scheduled/paused → running. Materializes `campaign_emails` rows.                                                                                                                                                                                                                                                                                                                                                       |
| POST   | `/campaigns/:id/pause`        | running → paused                                                                                                                                                                                                                                                                                                                                                                                                             |
| POST   | `/campaigns/:id/cancel`       | running/paused/draft → cancelled. Terminal for sending; `/reopen` puts it back to draft                                                                                                                                                                                                                                                                                                                                      |
| POST   | `/campaigns/:id/reopen`       | cancelled → draft. Safe to restart afterwards: recipients already sent to are never re-enqueued                                                                                                                                                                                                                                                                                                                              |
| POST   | `/campaigns/:id/test`         | `{ email, name?, subject?, preheader?, body?, body_source?, content_type?, from_email?, from_name?, reply_to?, template_id? }` → `{ ok, error }`. Sends one-off, using the campaign's _saved_ connections but any overrides passed in -- doesn't persist them or touch `campaign_emails`/progress. `email` need not be an existing subscriber.                                                                               |
| POST   | `/campaigns/preview`          | `{ subject?, preheader?, body, body_source?, content_type?, template_id? }` → `{ subject, preheader, html }`. Renders the given content the same way a real send would (template wrapper, merge fields, markdown conversion, tracking links against a synthetic subscriber) -- no saved campaign or sending connection required, so it works for a never-saved draft. Doesn't send anything.                                 |
| GET    | `/campaigns/:id/progress`     | `{ pending, queued, sent, failed, skipped, total }` -- always live, never cached                                                                                                                                                                                                                                                                                                                                             |
| GET    | `/campaigns/:id/analytics`    | `{ sent, opens, unique_opens, clicks, unique_clicks, unsubscribes, unique_unsubscribes, engagement, links }` -- see below                                                                                                                                                                                                                                                                                                    |
| GET    | `/campaigns/:id/unsubscribes` | `?limit=&offset=` → `{ unsubscribes, total }`. One entry per unsubscribe action: `subscriber_email`/`subscriber_name` (null once the contact is deleted), `source`, `list_ids`, and `lists` — the names for those ids that still resolve, so a list deleted since the unsubscribe leaves the id present with no name.                                                                                                        |

**`/campaigns/:id/analytics`** reports engagement on the _unique recipient_
basis every ESP uses, so the numbers are comparable to what Mailchimp or
FluentCRM show for the same send. `sent` (campaign emails with status `sent`)
is the denominator for open rate, click rate and unsubscribe rate;
click-to-open is unique clicks over unique openers. The raw `opens`/`clicks`
totals are kept alongside for the "N total" detail.

`engagement` is the same population split into three **disjoint** buckets that
sum to `sent`, so the campaign screen can chart it as a part-to-whole:
`clicked` (unique clickers), `opened_not_clicked` (opened, never clicked), and
`not_opened` (the remainder). A click with no recorded open is normal -- images
blocked, so the pixel never fired -- which is why the buckets come from set
membership rather than subtracting one count from the other, and why
`not_opened` is clamped at zero.

`links` is the per-URL click breakdown, `{ url, clicks, unique_clicks }`
ordered by unique clicks descending and capped at 50 rows (the endpoint is
polled every few seconds while a campaign runs).

**`preheader`** is the inbox-preview snippet shown next to the subject in the
recipient's mail client list -- it never appears inside the opened email.
Optional, supports the same merge fields as `subject`, and is silently
dropped for `content_type: "plain"` campaigns (the hidden-div technique it
uses is HTML-only). Implemented as a `display:none` div injected right after
`<body>` (or at the very top, for a template-less body) -- see
`injectPreheader` in `services/mailer.ts`.

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
| GET    | `/automations/:id/analytics`   | `{ unsubscribes, unique_unsubscribes }` — departures attributed to this automation's emails                                                                                                                                                                       |

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

## Media

Requires `media:get`/`media:manage`. Files live in the configured S3 store; the
`media` table only holds the row that points at them.

| Method | Path         | Notes                                                                                                                                  |
| ------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/media`     | `?query=&type=&page=&per_page=` → `{ results, total, page, per_page }`. `type=image` restricts the rows **and the total** to `image/*` |
| POST   | `/media`     | `multipart/form-data` with a single `file` field. `201` with the created item.                                                         |
| DELETE | `/media/:id` | Removes the row and the object from the bucket                                                                                         |

Each item is `{ id, uuid, provider, filename, content_type, size, meta,
created_at, url }`. **`url` is resolved on every read** -- a private bucket
returns a pre-signed URL that expires, so it must not be cached or persisted.
`filename` is the object key _without_ the configured bucket path prefix, so
changing that prefix doesn't orphan existing rows.

When media storage isn't configured (no bucket, or neither a region nor an
endpoint), every route here returns `400` with a message naming what's missing,
so the admin UI can point at Settings rather than showing a failure.

## Settings

Requires `settings:get`/`settings:manage`. Settings are stored per group in the
`settings` table: `media` and `system`.

| Method | Path                    | Notes                                                                                                                               |
| ------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/settings`             | `{ media, system }`, with `s3.secret_access_key` masked as `••••••••` when set                                                      |
| PUT    | `/settings`             | `{ media?, system? }` — each group is optional and whole; omitting one leaves it untouched, so each settings tab saves only its own |
| POST   | `/settings/media/test`  | `{ media }` — HeadBucket against the **body's** settings, not the saved ones                                                        |
| POST   | `/settings/system/test` | `{ to }` — sends a test message through the **saved** system connection, so it proves a password reset email would arrive           |

`system` is currently `{ connection_id: number \| null }` — the connection
Dripline sends its own mail through (password resets today). It is deliberately
one explicit choice rather than "any enabled connection": system mail must not
silently go out under a campaign's sending identity. `null` switches system
email off.

Sending the mask back verbatim in a `PUT` keeps the stored secret, so the UI can
round-trip settings without ever holding the real key -- the same contract as
the masked connection credentials.

`media` is:

```jsonc
{
  "provider": "s3",
  "extensions": ["jpg", "png", "..."], // lowercase, no dot; ["*"] allows everything
  "max_size_mb": 10,
  "s3": {
    "url": "", // endpoint; blank = AWS, derived from region
    "public_url": "", // CDN/custom domain; used even for a private bucket
    "region": "",
    "access_key_id": "", // both key fields blank = SDK default chain (IAM role)
    "secret_access_key": "",
    "bucket": "",
    "bucket_path": "", // optional prefix inside the bucket
    "bucket_type": "public", // "private" serves pre-signed URLs instead
    "expiry_seconds": 86400, // pre-signed URL lifetime; S3 caps this at 7 days
    "force_path_style": null, // null = inferred: AWS virtual-hosted, everything else path-style
  },
}
```

`/settings/media/test` returns `{ ok: true }`, or `400` with a message mapped
from the S3 status code (missing bucket / access denied / wrong region /
unreachable endpoint) -- S3 answers HeadBucket with a bare status and no body.

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

Note that the preference page's own routes (`/unsubscribe/:uuid/:subscriberUuid/lists`
and `/all`) take **either** a campaign or an automation uuid in that first slot --
automation emails reuse the same page, signing against the automation's uuid. Anything
resolving that uuid has to check both tables; `resolveUnsubscribeOrigin` in
`services/unsubscribes.ts` is the one place that does.

### Unsubscribe recording

Every one of these routes writes one row to `campaign_unsubscribes` per unsubscribe
**action** (not per list -- the lists left are in that row's `list_ids` array), tagged
with either `campaign_id` or `automation_id`, never both. `source` is `one_click`,
`preferences`, or `all`.

Only memberships the action _genuinely_ changed are counted: a repeat hit on the same
link records nothing. That matters because RFC 8058 one-click targets get re-fetched by
mail clients and security scanners, so counting requests rather than departures would
inflate the number. Rows are created going forward only -- unsubscribes predating this
table are not backfilled, and there is no way to reconstruct them, since
`subscriber_lists` holds current state with no campaign attribution.
