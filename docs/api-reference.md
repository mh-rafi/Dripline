# API reference

Base path: `/api/v1`. All endpoints except `/meta`, `/auth/login`, `/auth/setup`,
`/auth/forgot-password`, `/auth/reset-password`, `/automations/hooks/:key`, and
`/track/*` / `/unsubscribe/*` / `/u/*` require an
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

| Method | Path                                                                                         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/subscribers?q=&email=&attribs=&tags=&list_ids=&list_statuses=&blocklisted=&limit=&offset=` | Returns `{ subscribers: Subscriber[], total: number }` — `total` is the count of rows matching the current filter (ignoring `limit`/`offset`), for pagination and "select all matching". See [Filtering subscribers](#filtering-subscribers) for every filter. `limit` defaults to `50`, max `200`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| GET    | `/subscribers/:id`                                                                           | Includes list memberships                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| POST   | `/subscribers`                                                                               | `{ email, name?, status?, attribs?, attribs_mode?, list_ids?, preconfirm?, resubscribe? }` -- upserts by email, answering `201` on create and `200` on update. `status` is `enabled \| blocklisted` (default `enabled`). `preconfirm` marks the given `list_ids` as confirmed immediately instead of the opt-in-type default. `attribs_mode` (`merge \| replace`, default `merge`) governs an existing contact's [attributes](#subscriber-attributes-attribs); `resubscribe` (default `false`) is what lets `list_ids` lift a membership out of `unsubscribed` ([unsubscribes are sticky](#unsubscribes-are-sticky)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| PATCH  | `/subscribers/:id`                                                                           | `{ name?, attribs?, attribs_mode? }`. `attribs_mode` is `merge \| replace`, default `merge` -- see [Subscriber attributes](#subscriber-attributes-attribs).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| DELETE | `/subscribers/:id`                                                                           | Hard delete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| POST   | `/subscribers/:id/blocklist`                                                                 | Blocklists + unsubscribes from all lists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| POST   | `/subscribers/:id/unblocklist`                                                               | Reverses blocklisting; restores each list membership's status to whatever it was right before blocklisting force-unsubscribed it (tracked via `subscriber_lists.pre_blocklist_status`) -- a membership already unsubscribed before blocklisting stays unsubscribed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| PUT    | `/subscribers/:id/lists/:listId`                                                             | `{ status? }` add/update list membership. Being the explicit per-contact action, this is allowed to re-subscribe a membership that was `unsubscribed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| DELETE | `/subscribers/:id/lists/:listId`                                                             | Marks membership unsubscribed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| PUT    | `/subscribers/:id/tags/:tag`                                                                 | Adds a tag (no-op if already present) -- see [Tags](#tags)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| DELETE | `/subscribers/:id/tags/:tag`                                                                 | Removes a tag -- see [Tags](#tags)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| POST   | `/subscribers/import`                                                                        | `{ mode?, status?, list_ids?, overwrite_user_info?, overwrite_subscription_status?, attribs_mode?, tags_mode?, subscribers: [{ email, name?, attribs?, tags? }] }` bulk upsert, **max 1000 rows per request** (the admin UI posts in batches of 300). Returns `{ created, updated, failed: [{ email, error }] }` -- rows are applied independently, so one bad row is reported rather than discarding the batch, and an import is therefore not atomic. `mode` is `subscribe \| blocklist` (default `subscribe`); in blocklist mode `list_ids` is ignored. `status` (`unconfirmed \| confirmed`, default `confirmed`) is the list-membership status applied to every list in `list_ids`. The two `overwrite_*` flags (both default `false`) control whether an existing subscriber's name / membership status gets clobbered by the import vs. left alone. `attribs_mode` and `tags_mode` (`merge \| replace \| skip`, both default `merge`) govern an existing subscriber's [attributes](#subscriber-attributes-attribs) and [tags](#tags) independently of `overwrite_user_info`. The admin UI's import page does CSV parsing and column→field mapping client-side and posts the resulting `subscribers` array in batches -- there's no server-side CSV/file upload endpoint. |
| POST   | `/subscribers/bulk/blocklist`                                                                | `{ ids: number[] } \| { query: { q?, email?, attribs?, tags?, list_ids?, list_statuses?, blocklisted? }, all: true }` — bulk blocklist. `ids` is 1--1000 per request (the frontend chunks above that); `query` re-runs the same filter as `GET /subscribers`, with `list_ids`/`list_statuses` as real arrays here rather than comma-separated strings. Returns `{ affected }`. Single SQL statement, not a per-row loop. `pre_blocklist_status` is stashed so individual `unblocklist` can still restore later.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| POST   | `/subscribers/bulk/delete`                                                                   | Same selector shape — bulk hard delete (cascades to subscriber_lists, campaign_emails, bounces, etc.). Returns `{ affected }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| POST   | `/subscribers/bulk/lists`                                                                    | `BulkSelector & { list_ids: number[], action: "add" \| "remove", status?: "unconfirmed" \| "confirmed", trigger_automations?: boolean }` — bulk list management. `status` required when `action === "add"`. "Remove" = soft-unsubscribe (same as single-subscriber `removeFromList`). `trigger_automations` (default `false`) decides whether the affected contacts are enrolled in `list_applied`/`list_removed` automations — off by default so one bulk change can't enrol thousands of people by accident. Returns `{ affected }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| POST   | `/subscribers/export`                                                                        | `BulkSelector` — returns `text/csv` with `Content-Disposition: attachment`. Columns: `email,name,status,attribs,tags,lists` (attribs as JSON string, tags and lists semicolon-separated, lists as `name:status`). Export re-imports cleanly through the CSV import flow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### Subscriber attributes (`attribs`)

`attribs` is one free-form JSONB object per subscriber -- custom fields
(`plan`, `signup_source`, ...) that campaign templates read straight out of it
(`{{ Subscriber.Attribs.plan }}`). Tags are **not** in here; they are their own
column, documented below.

Every write that can land on an existing contact **merges by default**:

| Write                          | `attribs_mode`                 | Default       |
| ------------------------------ | ------------------------------ | ------------- |
| `POST /subscribers`            | `merge` \| `replace`           | `merge`       |
| `PATCH /subscribers/:id`       | `merge` \| `replace`           | `merge`       |
| `POST /subscribers/import`     | `merge` \| `replace` \| `skip` | `merge`       |
| `POST /automations/hooks/:key` | not accepted                   | always merges |

`merge` is a shallow top-level JSONB merge (`attribs || incoming`): the keys
you send are added or updated and everything else survives. `replace` swaps
the whole object -- it's what the admin UI's profile editor sends, because
that textarea holds the entire object and deleting a key there has to actually
delete it. Omitting `attribs` leaves the stored object untouched either way,
and clearing a contact's attributes means `attribs_mode: "replace"` with `{}`.

An event-driven integration therefore needs nothing special -- `POST
/subscribers` upserts by email and merges, so one call handles both a
first-touch contact and the fifth event for an existing one:

```jsonc
// POST /api/v1/subscribers
{
  "email": "a@example.com",
  "attribs": { "last_order_at": "2026-08-31" }, // merged; earlier keys survive
}
```

It answers `201` when it created the contact and `200` when it updated one, so
a caller can tell the two apart (only the create fires `contact_created`).

Two limits of `merge`: it is shallow, so a nested object under a key is
swapped whole rather than deep-merged; and it cannot remove a key -- setting
one to `null` stores a JSON null, and actually dropping keys means sending the
full desired object with `attribs_mode: "replace"`.

### Tags

Tags are a `text[]` column on the subscriber, not a key inside `attribs`. They
used to live at `attribs.tags`, which made every whole-object attribute write
silently untag the contact; the `1755820800024` migration moves them out and
backfills existing data, dropping the `tags` key from `attribs`.

Two consequences worth knowing when upgrading:

- A template referencing `{{ Subscriber.Attribs.tags }}` renders nothing now.
  The variable is `{{ Subscriber.Tags }}`.
- A stored `attribs` payload of your own containing a `tags` key no longer has
  any special meaning -- it is just another attribute, and it is not what the
  tag endpoints or the tag filter read.

`PUT /subscribers/:id/tags/:tag` and `DELETE .../tags/:tag` are the per-contact
writes; both are a single statement against the array, so concurrent tag
changes can't clobber each other. Adding a tag a contact already has is a
no-op. An import can also carry tags per row (`tags: string[]`), governed by
`tags_mode` the same way `attribs_mode` governs attributes.

### Filtering subscribers

`GET /subscribers` and every `BulkSelector` `query` take the same filter. In
the query string, `list_ids`, `list_statuses` and `tags` are comma-separated
and `attribs` is a JSON object; inside a `BulkSelector` they are real arrays
and objects.

| Filter          | Matches                                                                          |
| --------------- | -------------------------------------------------------------------------------- |
| `q`             | Substring of email **or** name. Not attributes, not tags                         |
| `email`         | One exact address                                                                |
| `attribs`       | JSONB containment: `?attribs={"plan":"pro"}` -- every key/value given must match |
| `tags`          | Array overlap: `?tags=vip,beta` matches a contact carrying **any** of them       |
| `list_ids`      | Member of any of these lists                                                     |
| `list_statuses` | Membership status, scoped to `list_ids` when both are given                      |
| `blocklisted`   | Account-wide blocklist state, OR'd with the list condition rather than AND'd     |

`attribs` and `tags` are backed by GIN indexes (`jsonb_path_ops` for
containment, the default operator class for array overlap), so segmenting on a
custom field stays an index scan rather than a sequential read. A malformed
`attribs` JSON string is a `400`, not a silently dropped filter -- an ignored
filter would quietly return the wrong people.

### Unsubscribes are sticky

Adding a contact to a list they already unsubscribed from does **not** opt them
back in. `POST /subscribers` with `list_ids`, and the `apply_list` automation
action, both leave an `unsubscribed` membership exactly as it is (and don't
fire `list_applied` for it) -- otherwise any recurring upsert, like a nightly
CRM sync, would quietly resurrect everyone who ever left.

Three writes can still raise a membership out of `unsubscribed`, each because
someone asked for it explicitly: `PUT /subscribers/:id/lists/:listId` (an admin
changing one membership by hand), `POST /subscribers` with `resubscribe: true`,
and `POST /subscribers/import` with `overwrite_subscription_status: true`. A
contact who re-opts-in through your own form is the case `resubscribe` is for.

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

Per connection, optional IMAP mailbox scanning for bounces **and spam
complaints** (a second, independent ingestion path alongside the
webhook-based `POST /bounces` -- see `docs/plan/mailbox_bounce_scanning.md`).
`connections.bounce_config`:

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

The scan recognizes two report formats in that mailbox: DSNs (RFC 3464),
recorded as `hard`/`soft`, and ARF feedback reports (RFC 5965) from a
provider's feedback loop, recorded as `complaint` -- which blocklists the
contact on the first occurrence. Both correlate back to the exact subscriber
and campaign through `campaign_emails.message_id`, so no extra outbound header
is involved. Only `Feedback-Type: abuse` and `fraud` are actioned; `not-spam`
is ignored on purpose (it is a positive signal, not a complaint).

Receiving complaints needs no extra Dripline config -- FBL reports arrive in
the same mailbox as bounces. It does need a one-time enrollment with each
provider's feedback loop (Microsoft SNDS/JMRP, Yahoo/AOL via Validity),
pointed at an address delivering into that mailbox. Gmail runs no per-message
feedback loop, so Gmail complaints are visible only in aggregate through
Google Postmaster Tools.

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

| Method | Path                          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/campaigns`                  | List                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| GET    | `/campaigns/:id`              | Includes attached `lists`, `connections` (ordered by priority), live `progress`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| POST   | `/campaigns`                  | `{ name, subject, preheader?, body, body_source?, alt_body?, content_type?, from_email?, from_name?, reply_to?, template_id?, list_ids, connection_ids, send_at?, rate_limit_count?, rate_limit_duration_seconds? }`. `content_type` one of `richtext \| html \| plain \| markdown \| visual` (default `richtext`). Rate limit fields must be set together or both omitted. `preheader` is the inbox-preview snippet and `alt_body` the plain-text alternative -- see notes below.                                                                                                                                                                 |
| PATCH  | `/campaigns/:id`              | Partial update (draft/scheduled/paused fields). `template_id`/`rate_limit_*`/`from_name`/`reply_to`/`preheader`/`alt_body` accept explicit `null` (or `""` for the latter three) to clear.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| PUT    | `/campaigns/:id/lists`        | `{ list_ids }` → `{ ok, removed }`. Replaces the attached lists and reconciles an already-materialized send queue against them: removing a list deletes the `pending` `campaign_emails` rows of contacts no longer eligible through any remaining list (`removed` counts them); `sent`/`failed`/`skipped`/`queued` are never touched, and a contact on another of the campaign's lists stays queued. Adding a list is picked up on the next start/resume. Rejected with `400` unless the campaign is `draft`, `scheduled` or `paused` — pause a running campaign first. See [plan/phases/02-dispatch-engine.md](plan/phases/02-dispatch-engine.md) |
| PUT    | `/campaigns/:id/connections`  | Replace the ordered connection chain (array order = priority, first is primary)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| DELETE | `/campaigns/:id`              | Only while draft/scheduled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| POST   | `/campaigns/:id/duplicate`    | Creates a new draft with the same content, lists, and connection chain. Never copies `send_at`, `status`, or send history/analytics -- the copy always starts as a fresh, unscheduled draft.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| POST   | `/campaigns/:id/start`        | draft/scheduled/paused → running. Materializes `campaign_emails` rows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| POST   | `/campaigns/:id/pause`        | running → paused                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| POST   | `/campaigns/:id/cancel`       | running/paused/draft → cancelled. Terminal for sending; `/reopen` puts it back to draft                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| POST   | `/campaigns/:id/reopen`       | cancelled → draft. Safe to restart afterwards: recipients already sent to are never re-enqueued                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| POST   | `/campaigns/:id/test`         | `{ email, name?, subject?, preheader?, body?, body_source?, alt_body?, content_type?, from_email?, from_name?, reply_to?, template_id? }` → `{ ok, error }`. Sends one-off, using the campaign's _saved_ connections but any overrides passed in -- doesn't persist them or touch `campaign_emails`/progress. `email` need not be an existing subscriber.                                                                                                                                                                                                                                                                                          |
| POST   | `/campaigns/preview`          | `{ subject?, preheader?, body, body_source?, content_type?, template_id? }` → `{ subject, preheader, html }`. Renders the given content the same way a real send would (template wrapper, merge fields, markdown conversion, tracking links against a synthetic subscriber) -- no saved campaign or sending connection required, so it works for a never-saved draft. Doesn't send anything.                                                                                                                                                                                                                                                       |
| GET    | `/campaigns/:id/progress`     | `{ pending, queued, sent, failed, skipped, total }` -- always live, never cached                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| GET    | `/campaigns/:id/analytics`    | `{ sent, opens, unique_opens, clicks, unique_clicks, unsubscribes, unique_unsubscribes, reasons, engagement, links }` -- see below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| GET    | `/campaigns/:id/unsubscribes` | `?limit=&offset=` → `{ unsubscribes, total }`. One entry per unsubscribe action: `subscriber_email`/`subscriber_name` (null once the contact is deleted), `source`, `reason`/`reason_comment` (both null unless they answered the optional question — see **Unsubscribe reasons**), `list_ids`, and `lists` — the names for those ids that still resolve, so a list deleted since the unsubscribe leaves the id present with no name.                                                                                                                                                                                                              |

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

**`alt_body`** is the `text/plain` half of the message. Every campaign is sent
as `multipart/alternative` -- HTML with no text part is a standing SpamAssassin
penalty -- so this is an override, not a toggle: leave it null (the default) and
the text part is derived from the rendered HTML at send time by
`lib/htmlToText.ts`. Supports the same merge fields as the body. Ignored for
`content_type: "plain"` campaigns, which are already text and go out as a single
`text/plain` part with no HTML at all. See
[plan/deliverability.md](plan/deliverability.md).

## Automations

Node-graph automations -- see [plan/automations_v2.md](plan/automations_v2.md) for the
model. `graph` is `{ entry: <node id|null>, nodes: [{ id, type, title?, note?, config, next }] }`
with pointer edges, not array order.

| Method | Path                                                | Notes                                                                                                                                                                                                                                                                                                                                                                    |
| ------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/automations`                                      | List, each with `enrollment_counts`                                                                                                                                                                                                                                                                                                                                      |
| GET    | `/automations/registry`                             | `{ triggers, actions }` -- the trigger/action catalogue this build supports (`type`, `label`, `description`, `group`)                                                                                                                                                                                                                                                    |
| GET    | `/automations/:id`                                  | Detail, including `enrollment_counts`                                                                                                                                                                                                                                                                                                                                    |
| POST   | `/automations`                                      | `{ name, trigger_type, trigger_config? }`. Trigger defaults are filled server-side (an incoming-webhook automation gets its secret `key` here)                                                                                                                                                                                                                           |
| PATCH  | `/automations/:id`                                  | `{ name?, trigger_config?, graph?, status?, reentry_mode? }`. A saved graph is checked structurally (unique ids, edges pointing at real nodes); per-node config is only validated when `status: "published"`, so half-configured steps can be saved while editing                                                                                                        |
| DELETE | `/automations/:id`                                  | Also removes the enrollments                                                                                                                                                                                                                                                                                                                                             |
| POST   | `/automations/:id/enroll`                           | `{ subscriber_id }` manual enrollment (respects `reentry_mode` and publish state)                                                                                                                                                                                                                                                                                        |
| GET    | `/automations/:id/enrollments`                      | `?page=&per_page=&status=&query=` → `{ enrollments, total, page, per_page }`. `status` is `all\|active\|completed\|cancelled`; `query` matches contact name or email. Rows carry `current_node_id`, not a rendered step name — the caller has the graph and can name the node, so a step renamed later reads correctly for historical rows too                           |
| GET    | `/automations/:id/analytics`                        | `{ unsubscribes, unique_unsubscribes, reasons, nodes }` — departures attributed to this automation's emails, plus the reason breakdown. `nodes` is per-email-step engagement — `{ node_id, sent, opens, unique_opens, clicks, unique_clicks, links }`, only for steps that have sent something. The builder's email panel reads it; the unsubscribe half still has no UI |
| POST   | `/automations/:id/test`                             | `{ email, name?, ...send_custom_email config }` → `{ ok, error }`. Test-sends one email step using the config in the request rather than the saved graph, so unsaved edits can be tried. Renders through the same path the live action uses; creates no enrollment and advances nobody                                                                                   |
| POST   | `/automations/:id/preview`                          | `{ subject?, body?, body_source?, content_type?, template_id? }` → `{ subject, html }`. Renders one email step through the same path a real send uses (template wrapper, merge fields, automation unsubscribe link) against a synthetic contact. No connection needed, and an empty subject/body is accepted — previewing happens mid-draft                              |
| GET    | `/automations/:id/report`                           | The funnel: `{ entered, enrollment_counts, steps, conversion_pct }`. One `steps` entry per graph node in path order, with `contacts` (who reached it, from `automation_node_runs`), `pct`/`drop_pct` against the entrance, and for email steps an `email` block of sent/opens/clicks/unsubscribes plus per-link clicks                                                   |
| POST   | `/automations/:id/enrollments/:enrollmentId/cancel` | Stops an active run. `404` if it is already finished. History is kept, so the funnel still counts the contact at every step they reached                                                                                                                                                                                                                                 |
| DELETE | `/automations/:id/enrollments/:enrollmentId`        | Removes the enrollment. Its node-run rows cascade, so the funnel forgets the contact entirely — unlike cancel                                                                                                                                                                                                                                                            |

Triggers: `list_applied`, `list_removed`, `contact_created`, `webhook_incoming`.
The two list triggers require at least one list in `trigger_config.list_ids` --
an empty selection neither publishes nor matches anything.
Actions: `wait`, `send_custom_email`, `apply_list`, `remove_list`.
`send_custom_email` takes an optional `template_id` -- null or absent sends the
body unwrapped (the default), otherwise the body goes into that template's
`{{ Body }}` slot, the same wrapper campaigns use. Ignored for
`content_type: "plain"`.
Both are registries (`apps/api/src/automations/`) -- adding one is a single entry there
plus its UI counterpart in `apps/web/src/automations/`.

`status` is `draft | published | paused`. Only `published` automations enrol contacts;
pausing holds contacts in place rather than dropping them.

## Event ingestion

| Method | Path                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/automations/hooks/:key` | **Unauthenticated** -- the per-automation `key` is the credential. `{ email? \| subscriber_id?, name?, attribs?, ...payload }`. Creates the contact if `email` is unknown, then enrols them in the `webhook_incoming` automation owning that key. `attribs` is applied only on the `email` path (ignored when you pass `subscriber_id`) and always **merges** -- repeated events each carry a partial payload, so replacing would have every call wipe the last one's data ([Subscriber attributes](#subscriber-attributes-attribs)). |
| POST   | `/bounces`                | `{ email, campaign_uuid?, type: "hard"\|"soft"\|"complaint", source?, meta? }`. Auto-blocklists per threshold.                                                                                                                                                                                                                                                                                                                                                                                                                        |

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

These URLs are generated automatically inside sent emails -- you should not need
to construct them by hand.

Ids are base62 (`lib/shortId.ts`) and `:sig` is 16 hex characters of HMAC-SHA256
over the rest of the path. The paths are this terse on purpose: SpamAssassin
penalizes links much past 120 characters, and the older shape below ran to about 260. See [plan/deliverability.md](plan/deliverability.md).

| Method   | Path                                     | Note                                                                                                                                                                  |
| -------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET      | `/l/:campaign/:subscriber/:link/:sig`    | Click. Not under `/api/v1` -- top-level, for the length. Resolves `:link` against `links` and redirects. A bad signature still redirects, it just isn't recorded.     |
| GET      | `/o/:campaign/:subscriber/:sig`          | Open pixel. Also top-level.                                                                                                                                           |
| GET      | `/al/:node/:subscriber/:link/:sig`       | Automation click. `:node` is an `automation_email_nodes` id, so a click lands on the exact step that sent the mail. Same redirect-on-bad-signature behaviour as `/l/` |
| GET      | `/ao/:node/:subscriber/:sig`             | Automation open pixel. Signature prefixes differ from `/l/` and `/o/` so a campaign URL cannot be replayed here                                                       |
| GET/POST | `/api/v1/u/:ref/:subscriber/:sig`        | One-click (RFC 8058) unsubscribe target.                                                                                                                              |
| GET      | `/api/v1/u/:ref/:subscriber/:sig/lists`  | Lists the preference page offers.                                                                                                                                     |
| POST     | `/api/v1/u/:ref/:subscriber/:sig/lists`  | `{ list_ids }` -- leave the selected lists. Returns `{ ok, unsubscribe_id }`.                                                                                         |
| POST     | `/api/v1/u/:ref/:subscriber/:sig/all`    | Leave everything. Returns `{ ok, unsubscribe_id }`.                                                                                                                   |
| POST     | `/api/v1/u/:ref/:subscriber/:sig/reason` | `{ unsubscribe_id, reason, comment? }` -- optional feedback on a departure that already happened.                                                                     |

`:ref` carries which kind of send the unsubscribe came from: `c` + campaign id,
or `a` + automation id. Campaign and automation emails share one preference
page, and this is what tells them apart.

One-click on a campaign leaves the lists that campaign was sent through. An
automation isn't list-scoped that way, so one-click there leaves every list; the
visible link in the body still goes to the per-list preference page.

The human-facing preference page is a client-side route at
`/u/:ref/:subscriber/:sig` (and the older `/unsubscribe/:campaignUuid/:subscriberUuid`),
not an API endpoint.

### Older uuid-based tracking URLs

Still served, and permanently: mail carrying them can sit in an inbox
indefinitely. Nothing generates them any more.

| Method   | Path                                                           |
| -------- | -------------------------------------------------------------- |
| GET      | `/track/open/:campaignUuid/:subscriberUuid?sig=`               |
| GET      | `/track/click/:campaignUuid/:subscriberUuid?url=&sig=`         |
| GET/POST | `/unsubscribe/:campaignUuid/:subscriberUuid?sig=`              |
| GET/POST | `/unsubscribe/automation/:automationUuid/:subscriberUuid?sig=` |

The preference page's own routes on this older shape
(`/unsubscribe/:uuid/:subscriberUuid/lists` and `/all`) take **either** a
campaign or an automation uuid in that first slot, so anything resolving that
uuid has to check both tables -- `resolveUnsubscribeOrigin` in
`services/unsubscribes.ts` is the one place that does. The `:ref` prefix on the
short form exists to make that lookup unnecessary.

### Unsubscribe reasons

The preference page asks _why_ only **after** the unsubscribe has been recorded,
on the confirmation screen, with a skip. It is never a gate in front of leaving,
so the two POSTs above return the new row's `unsubscribe_id` and the page
follows up with `/reason`. `unsubscribe_id` is `null` when the click changed
nothing (a repeat visit) -- there is no row to attach anything to, and the page
doesn't offer the question. One-click (RFC 8058) departures never carry a
reason: they're a machine POST with nobody to ask.

`reason` must be one of the values in `lib/unsubscribeReasons.ts` (`too_many`,
`not_relevant`, `never_signed_up`, `not_interested`, `other` at time of
writing) -- a code-side registry rather than a DB `CHECK`, so adding one is a
single entry there plus its label in the web counterpart, with no migration.
Rows naming a value since removed from the registry still read back fine, and
the admin UI falls back to showing the raw value. `comment` is optional free
text capped at 500 characters.

Two properties, both enforced in `setUnsubscribeReason`:

- **Scoped to the signed link's subscriber.** The `UPDATE` matches on the
  subscriber id taken from the URL, never from the body, so holding one valid
  unsubscribe link cannot write a reason onto somebody else's row by guessing
  at the sequential `unsubscribe_id`.
- **Write-once.** It only matches rows where `reason IS NULL`, so a replayed
  request can't overwrite what was already said.

Both return `{ ok: true }` either way -- a departing reader gets nothing useful
from a failed optional survey, and the page swallows the error for the same
reason.

Reasons surface in two places: a `Reason` column on the
`/campaigns/:id/unsubscribes` rows, and a `reasons: [{ reason, count }]`
breakdown on both analytics endpoints, ordered most-common-first and covering
only the people who answered -- the gap between their sum and `unsubscribes` is
how many skipped, which is why the admin UI shows shares against the answered
count rather than against everyone who left.

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
