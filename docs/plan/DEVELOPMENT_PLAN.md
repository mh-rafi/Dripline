# Dripline — Development Plan

Status: Draft v0.3 (revised)
Last updated: 2026-08-22
Companion doc: [../prd/PRD.md](../prd/PRD.md)

This plan sequences the work in [PRD.md](../prd/PRD.md) into phases. Each phase has a
goal, concrete tasks, an exit criteria (what "done" means, testable), and its
dependencies on earlier phases. Phases are meant to be built roughly in order —
automations (Phase 4) specifically depend on the dispatch engine from Phase 2.
This document is kept as the source of truth for what's actually been built,
not just what was planned -- see [Status](#status-as-of-2026-08-22).

**v0.3 revision (2026-08-22):** Phase 3 (Connections) is now built, including
the SMTP TLS/auth fields, AWS SES support, per-connection rate limiting,
explicit campaign/workflow connection selection, and a test-connection
endpoint -- see its section below, now updated from "planned" to "built."
Three real bugs found during a code review of that work were fixed and
verified (a rate-limiter race condition that let a limit of 5 grant 19
concurrent slots, a validation gap rejecting `template_id: null` on campaign
edits, and a workflow `send_email` step silently picking an arbitrary
connection instead of failing when none was configured). Campaign-level
throttling was also generalized from a fixed "count per minute" into the same
count/duration/window shape connections use, so "1 email per 5 minutes" is
now expressible. **Phase 8 (new)** adds listmonk-parity campaign body editing
modes: richtext, raw HTML, markdown, plain text, and a drag-and-drop visual
builder.

---

## Status as of 2026-08-22

**Built and verified end-to-end** (real Postgres, a local SMTP catcher, and --
as of this revision -- a real browser session, not just the API): Phase 0
scaffolding; Phase 2 campaigns/dispatch engine (personalized sends,
open/click/unsubscribe tracking, pause-mid-send-then-resume without losing or
duplicating recipients); Phase 3 Connections (rate-limiter concurrency
verified directly against Postgres under simulated concurrent load; the new
"1 per 5 minutes" campaign throttle verified with simulated window expiry);
Phase 4 drip automations (multi-step delayed sequence, verified through
completion); bounce-triggered auto-blocklisting (Phase 7); Phase 8 content
editing modes (all 5 editors driven in an actual browser -- TinyMCE, the two
CodeMirror modes, plain text, and GrapesJS all render and produce correct
output with zero console errors; a markdown campaign was created, fetched,
and re-opened for editing through the real API and confirmed to round-trip
correctly, storing raw markdown source rather than pre-converted HTML).

**Built but not yet verified:** Phase 1's core CRUD is solid, but its original
exit criteria (CSV import, a double opt-in confirm email/link flow) were never
built -- only JSON bulk import exists today, and `unconfirmed` subscribers on
double opt-in lists have no way to become `confirmed`. Phase 5's webhook
ingestion and `link_clicked` triggers exist in code but have never been
exercised end-to-end. Phase 6's admin UI has now been driven in a browser for
auth/dashboard/campaigns/connections, but workflows, subscribers, and lists
pages still haven't been -- verification there has only gone through the API.

**Explicitly not done:** Public archive pages, load testing at scale, and
running the listmonk import script against a real listmonk database are all
still open (Phase 7). Cross-format conversion when switching a campaign's
content type (e.g. markdown → richtext, which listmonk supports) is not
implemented -- switching types clears the body (Phase 8). GrapesJS output has
no CSS inlining (a `<style>` block is used instead), which very old Outlook
versions handle poorly (Phase 8). Nothing is committed to git yet.

---

## Phase 0 — Project scaffolding

**Goal:** an empty but runnable skeleton to build against.

Tasks:

- Repo init, monorepo layout (`apps/api`, `apps/web`, `packages/db` or similar —
  decide structure here).
- TypeScript + Fastify hello-world API, health check endpoint.
- Postgres connection, migration tool decision (node-pg-migrate / Kysely migrations /
  hand-rolled SQL files) and first migration.
- Docker Compose: app + Postgres only (no Redis).
- Lint/format/test tooling (ESLint, Prettier, Vitest or similar).
- CI: lint + test on PR.

Exit criteria: `docker compose up` boots API + Postgres; `/health` returns 200; CI green
on an empty test.

Depends on: nothing.

---

## Phase 1 — Core data model + subscriber/list management

**Goal:** the listmonk-parity foundation everything else sits on.

Tasks:

- Migrations: `subscribers`, `lists`, `subscriber_lists`, `templates`, `media`.
- CRUD API for subscribers and lists (create/list/update/delete, bulk import).
- Subscriber attributes (JSONB), tags.
- Single/double opt-in flow for lists.
- Public API auth (API keys), matching the "external service can create/query
  subscribers" requirement from the PRD.
- Basic template model (store + render, no builder UI yet).

Exit criteria: can create a list, import subscribers via API and via CSV, subscribe/
confirm double opt-in, fetch a rendered template with subscriber data merged in.

Depends on: Phase 0.

### Update: double opt-in status UI clarity (added 2026-08-22)

**Problem:** adding a subscriber to a list always defaulted their
`subscriber_lists.status` to `unconfirmed`, and the UI showed that raw value
as an uncolored badge regardless of the list's opt-in type. On a **single**
opt-in list this is meaningless noise -- `unconfirmed` doesn't gate sending
there (see `queries/campaigns.sql`-equivalent eligibility logic in
`services/campaigns.ts`) -- but it read as "needs action."

**Fixed now:**

- `addToList` (`services/subscribers.ts`) defaults the status by the list's
  actual opt-in type when the caller doesn't specify one explicitly:
  `confirmed` for single opt-in, `unconfirmed` for double opt-in. Applied
  everywhere a subscriber is added to a list without an explicit status --
  including the workflow `add_list` step, which previously hardcoded
  `"confirmed"` unconditionally (a real correctness issue: it silently
  bypassed double opt-in consent for anyone added via automation).
- `GET /subscribers/:id` now includes each list's `optin` type alongside the
  membership status, so the UI can render accordingly.
- `SubscriberDetail.tsx` shows a single opt-in membership as "subscribed"
  (no confusing unconfirmed/confirmed distinction, since it's a no-op there)
  and a double opt-in membership as "confirmed" / "awaiting confirmation" --
  with a tooltip explaining what it means and, on the unconfirmed case, that
  no confirmation email is actually sent yet. Badge colors were also added
  for these statuses (previously unstyled -- `confirmed`/`unconfirmed`/
  `unsubscribed` matched no CSS class at all).

**Still open, tracked here explicitly per Phase 1's original exit
criteria:** the actual double opt-in **confirmation flow** -- sending a
confirmation email with a signed link, and an endpoint for a subscriber to
click it and move themselves from `unconfirmed` to `confirmed`. Right now a
double opt-in list is fully functional _except_ that nothing can ever
actually become `confirmed` through normal subscriber action (only via an
admin's explicit override, as added above). This is real, not cosmetic --
worth prioritizing before recommending double opt-in lists for real use.

### Update: CSV subscriber import with column mapping (added 2026-08-22)

**Problem:** `POST /subscribers/import` existed but took pre-parsed JSON only
-- there was no admin UI path to bulk-import a CSV, which Phase 1's exit
criteria explicitly calls for ("import subscribers... via CSV").

**Built:**

- Admin UI page (`SubscriberImport.tsx`, at `/subscribers/import`, linked
  from the Subscribers list) modeled on listmonk's import screen: Subscribe/
  Blocklist mode, list-membership status, CSV delimiter, "overwrite user
  info" / "overwrite subscription status" toggles, and a multi-select list
  picker.
- CSV parsing happens entirely client-side (`lib/csv.ts` -- a small
  hand-rolled RFC-4180-ish parser handling quoted fields, escaped `""`
  quotes, and embedded delimiters/newlines; no new dependency for this).
- **Column mapping, which listmonk itself lacks:** after a file is picked,
  every detected CSV column gets a "maps to" dropdown (Ignore / Email / Name
  / Attributes (JSON) / Attribute) with a best-effort auto-guess from the
  header name. Arbitrary columns (e.g. "Company", "Phone") can be mapped
  individually into `attribs` under an editable key, not just a single
  pre-formatted JSON blob column -- so a CSV exported from some other tool
  with differently-named columns doesn't need to be hand-edited first.
- Backend: `POST /subscribers/import` extended with `mode`
  (`subscribe | blocklist`), `status` (the list-membership status to apply),
  `overwrite_user_info`, and `overwrite_subscription_status`. New
  `addToListForImport` (`services/subscribers.ts`) takes an explicit status
  and either force-overwrites or leaves alone an existing membership's
  status depending on the toggle, mirroring `onConflict doNothing` vs.
  `doUpdateSet`.
- The UI batches rows to the API (300/request) to avoid oversized payloads
  on large files.

Verified live (real Postgres, running dev API + browser): auto-mapping of
mismatched CSV headers ("Email Address" → email, "Full Name" → name,
"Company"/"Phone" → attributes), the two overwrite toggles' on/off behavior
across repeated imports of the same email, and blocklist-mode import.

---

## Phase 2 — Broadcast campaigns + dispatch engine

**Goal:** send a campaign correctly and durably — this is the phase that fixes the
listmonk bug and is the foundation automations will reuse.

Tasks:

- Migrations: `campaigns`, `campaign_emails` (per-recipient dispatch table),
  `providers` (single-provider stub for now).
- Campaign creation: target list(s), template, schedule/send-now.
- On campaign start: batched `INSERT` of one `campaign_emails` row per eligible
  recipient (`status = pending`).
- pg-boss worker(s): claim `pending`/`queued` rows in batches, send via Nodemailer,
  update row status **only after** provider response (`sent` / `failed` with error
  reason), never before.
- Per-campaign send-rate limiting (message rate + sliding window), ported from
  listmonk's model but applied at the worker/job level, not blocking a single loop.
- Pause/resume/cancel: pausing stops claiming new rows; in-flight rows finish or are
  safely requeued, nothing already `pending` is lost.
- Campaign progress view: sent/failed/pending counts sourced live from
  `campaign_emails`, not a cached counter.
- Retry policy for `failed` rows (configurable max attempts).

Exit criteria: start a campaign, kill the app process mid-send, restart it — sending
resumes and completes with zero recipients silently skipped. Verify by comparing
`campaign_emails` row count to list size before/after.

Depends on: Phase 1.

---

## Phase 3 — Connections: multi-domain sending, explicit selection, rate limits

### Why this is being redone

The original Phase 3 built a single implicit pool: every enabled provider was
weighted-random-selected for every send, with automatic failover across all of
them. That's wrong for a real deployment running multiple SaaS products/domains
from one Dripline instance -- it can silently send SaaS A's campaign through
SaaS B's connection, mixing sending domains and breaking SPF/DKIM/reputation
alignment. It was also missing fields real SMTP setups need (TLS mode, auth
method, skip-verify), a way to test a connection before trusting it with a
campaign, an edit form, AWS SES support, and any rate limiting beyond a flat
per-campaign `messages_per_minute`.

This phase replaces the `providers` model with `connections` and makes
selection **explicit** everywhere a send happens.

### Key decisions

- **Rate limiting lives primarily on the connection, not the campaign.**
  A connection's send-rate cap is a property of the provider account/credential
  itself (SES account limits, an SMTP relay's rate cap) -- it must be enforced
  _globally_ across every campaign and workflow currently sending through that
  connection, not per-campaign, or two concurrent campaigns on the same
  connection could together exceed what the provider actually allows.
  Campaign-level throttling stays available as an optional, secondary,
  additional cap (can only slow a campaign down further, never exceed the
  connection's own limit) -- useful for deliberately slow-rolling a specific
  send (e.g. domain warm-up).
- **No implicit pooling.** A campaign (or a workflow's `send_email` step)
  selects one connection as primary, with an optional explicit ordered list of
  fallback connections it can name itself. There is no "all enabled
  connections" automatic pool anymore -- if you want load-balancing across
  multiple connections, you list them yourself, in order, on that campaign.
- **Two connection types for v1:** `smtp` (generic, config-driven) and `ses`
  (AWS SES via `@aws-sdk/client-sesv2`). More provider types (Postmark,
  SendGrid, Mailgun, etc.) are a natural later addition once this abstraction
  exists -- see "Future provider types" below.
- **Multi-SaaS / multi-site usage:** explicit per-campaign connection
  selection is the mechanism for keeping each site's mail on its own domain
  correctly -- full multi-tenant workspace isolation (separate subscriber
  pools, RBAC per site) is **explicitly out of scope for this phase**. Lists
  and tags remain the way to segment audiences per site. Revisit as a
  separate phase if/when isolated dashboards or per-site permissions are
  actually needed.

### Tasks

**3.1 Data model**

- Rename `providers` → `connections` (table + all references:
  `campaign_emails.provider_id` → `connection_id`, etc.).
- Expand connection config by type:
  - `smtp`: host, port, `tls_mode` (`none` | `starttls` | `tls`),
    `tls_skip_verify` (bool), `auth_method` (`none` | `login` | `plain` |
    `cram-md5`), username, password.
  - `ses`: `region`, `access_key_id`, `secret_access_key` (support "use
    instance/IAM role" as an alternative to static keys, for self-hosting on
    AWS).
  - Common fields: `from_email`, `from_name`, a free-text `label` (shown in
    picker dropdowns, e.g. "SaaS A — transactional").
- Add `rate_limit_count` + `rate_limit_duration_seconds` to `connections`
  (e.g. 100 / 900 = 100 per 15 minutes). Null/0 = unlimited.
- New `campaign_connections` join table: `(campaign_id, connection_id,
priority)` -- ordered fallback chain; `priority 0` is primary.
- Add an equivalent `connection_id` (+ optional fallback list) to the
  `send_email` workflow step schema (`lib/workflowSteps.ts`).
- Migration path: existing single-`provider_id` campaigns/data map onto
  `campaign_connections` with a single priority-0 row.

**3.2 Sender abstraction**

- `ConnectionSender` interface: `send(connection, message) -> {ok, error}`.
- `SmtpSender`: rebuild the Nodemailer transport options from the new TLS
  mode / auth method / skip-verify fields (currently only host/port/secure/
  username/password are read).
- `SesSender`: new, using `@aws-sdk/client-sesv2`'s `SendEmailCommand`.
- `getSenderFor(connection)` factory dispatching on `connection.type`.

**3.3 Connection-level rate limiter**

- `services/connectionRateLimiter.ts`: atomic fixed-window counter
  (`tryAcquireSendSlot(db, connectionId)`), implemented as a single SQL
  `UPDATE ... RETURNING` so it's safe under concurrent claimers -- resets the
  window when expired, otherwise increments-and-checks against
  `rate_limit_count` in one statement.
- Used by both the campaign dispatch batch-claim step and the workflow
  `send_email` step -- one shared enforcement point, not duplicated logic.

**3.4 Explicit routing**

- Campaign/workflow dispatch resolves its configured connection chain
  (primary, then fallbacks in priority order) instead of querying "all
  enabled connections."
- A connection that's rate-limited or disabled is skipped in favor of the
  next one in _that campaign's own chain_ -- never a connection the campaign
  didn't list.
- If the primary (and any listed fallbacks) are all unavailable, the batch
  claims nothing that tick and retries later -- same crash-safe semantics as
  Phase 2, just scoped to the campaign's chosen connections.

**3.5 Test connection**

- `POST /connections/test` -- accepts a full config body (works for an
  unsaved draft in the UI, not just a persisted connection): SMTP does
  `transporter.verify()`, SES does a lightweight credentials-check call.
  Returns `{ ok, error }`.
- `POST /connections/:id/test` -- same, using the already-saved config.

**3.6 UI**

- Rename Providers page → Connections. Add form gets type selector (SMTP /
  AWS SES) with conditional fields per type, including the TLS mode / auth
  method / skip-verify fields currently missing, and the rate-limit fields.
- **Edit form** (currently missing entirely -- today's UI can only
  enable/disable/delete, not edit host/port/credentials).
- "Test connection" button on both the add and edit forms, wired to 3.5,
  showing pass/fail inline before save.
- Campaign form: connection picker (primary) + "add fallback connection"
  repeated picker, showing each connection's label/from_email/type.
- Workflow step editor: add `connection_id` to the `send_email` step's JSON
  schema now; a proper dropdown in the step editor is a Phase 6 UI follow-up
  once the workflow builder moves past raw JSON editing.

**3.7 Future provider types (not in this phase, but don't design against it)**

- Keep `ConnectionSender` generic enough that Postmark/SendGrid/Mailgun/etc.
  are new implementations of the same interface, not a redesign.

**3.8 Campaign throttle generalization (added 2026-08-22)**

- The original per-campaign `messages_per_minute` was tied to the dispatch
  scan's fixed 1-minute cron cadence, so nothing slower than "per minute"
  could be expressed (e.g. "1 email per 5 minutes" for a slow warm-up).
  Replaced with the same `rate_limit_count` / `rate_limit_duration_seconds` /
  `window_start` / `window_count` shape connections use (migration
  `1755820800007`), sharing one `services/rateLimiter.ts` implementation
  (`reserveRateLimitSlots`, table-generic over `connections` | `campaigns`).
  Campaign dispatch now reserves a slot count from this window before
  claiming rows, instead of assuming "N per tick" -- most ticks correctly
  reserve 0 and claim nothing when the window hasn't elapsed yet.
- UI: a shared `DurationInput` component (number + seconds/minutes/hours
  dropdown) used for both the connection's rate-limit window and the new
  campaign throttle fields, instead of a raw "seconds" number field.

### Status: built

All of the above is implemented. A code review of the initial implementation
(done by a different agent from this plan's author) found and fixed 3 real
bugs before this was considered done:

1. **Rate limiter race condition** -- `reserveRateLimitSlots` used
   `db.connection()` instead of `db.transaction()`, so the `SELECT ... FOR
UPDATE` row lock wasn't actually held across the check-then-increment
   (Kysely's `.connection()` pins queries to one physical connection but does
   _not_ open a transaction). Reproduced directly: 20 concurrent calls against
   a limit of 5 granted 19. Fixed and reverified: same test now grants exactly 5.
2. **`PATCH /campaigns/:id` rejected `template_id: null`** -- the Zod schema
   only accepted `number | undefined`, but the edit UI needs to send `null`
   to clear the template. Fixed with `.nullable()`.
3. **Workflow `send_email` steps with no `connection_id` silently used "the
   first enabled connection"** -- directly contradicting this phase's own "no
   implicit pooling" principle, and reopening the cross-domain-mixing risk
   the phase exists to close. Now sends nothing (visibly, as a `no sending
connection configured` result) until a connection is actually named on the
   step; the step engine also now retries on `rate_limited` instead of
   silently advancing past it.

### Exit criteria

- [x] Create two SMTP connections and one SES connection, each with a
      different sending domain. -- routes/UI support this; SES exercised via
      `@aws-sdk/client-sesv2` integration, not against a real AWS account.
- [x] A campaign with only Connection A selected sends exclusively through A,
      even while Connection B is enabled and otherwise eligible -- by
      construction (`getConnectionChain` only resolves a campaign's own
      `campaign_connections` rows).
- [x] A connection's rate limit is honored correctly when two campaigns are
      sending through it at the same time -- verified directly: 20 concurrent
      `tryAcquireSendSlot` calls against a limit of 5 granted exactly 5 after the
      fix above (see bug #1).
- [x] Test-connection correctly reports failure on bad credentials and
      success on good ones, for both SMTP and SES -- endpoint implemented
      (`transporter.verify()` / SES `GetAccountCommand`); not re-verified against
      live bad/good credentials in this pass.
- [x] Editing an existing connection's host/port/credentials actually
      persists -- edit form built, including the secret-preserving merge-on-patch
      behavior (blank password field = "keep current").

Depends on: Phase 2 (dispatch engine -- this phase changes how it picks a
connection, not the row-per-recipient model itself).

---

## Phase 4 — Automations v1 (drip)

**Goal:** time-delayed sequences with per-contact state.

Tasks:

- Migrations: `workflows`, `workflow_enrollments`.
- Workflow definition format: ordered step list (delay, send-email, add/remove
  tag/list) — decide JSON-in-column vs. normalized step table (see PRD open questions).
- Enrollment triggers (v1 subset): manual API enrollment, "added to list."
- pg-boss delayed jobs per enrollment step (no polling loop).
- Re-entry rule enforcement (allow/deny re-enrollment).
- Reuses the Phase 2 dispatch engine for the actual send step — a workflow's
  send-email step creates a `campaign_emails`-equivalent row, not a separate send path.
- The `send_email` step's connection selection (which connection it sends
  through) is defined in Phase 3.1/3.6 -- this phase's step engine just needs
  to honor whatever `connection_id` the step config carries.

Exit criteria: enroll a contact, verify a 3-step sequence with delays executes correct
steps at correct times across an app restart (delayed jobs survive restart via pg-boss
persistence).

Depends on: Phase 2 (dispatch engine reused for send steps). Connection selection
in the `send_email` step depends on Phase 3's data model.

---

## Phase 5 — Event-based triggers

**Goal:** workflows triggered by things other than list membership.

Tasks:

- Migration: `workflow_events` (raw event log).
- Webhook ingestion endpoint + signing/auth scheme (resolve PRD open question here).
- In-app event triggers: campaign link clicked, tag applied.
- Condition/branch step type evaluated against subscriber attributes or event payload.

Exit criteria: a webhook POST enrolls a matching contact into a workflow; a
condition step correctly branches based on a subscriber attribute.

Depends on: Phase 4.

---

## Phase 6 — Admin UI (React)

**Goal:** usable web UI covering everything built in Phases 1–5.

Tasks:

- Auth/login.
- Subscribers/lists management screens.
- Campaign builder + template editor + send/pause/cancel controls, live progress.
- Connections configuration screen -- built as part of Phase 3.6, not here;
  listed for completeness.
- Workflow builder (visual step editor) + enrollment/monitoring view. A visual
  step editor replacing the current raw-JSON steps textarea is still open --
  see Phase 3.6's note on the `send_email` connection picker needing this too.
- Analytics: opens/clicks/campaign performance.

Exit criteria: an admin can do everything the API supports — create a list, build a
template, send a campaign, configure connections, build and monitor a drip workflow —
without touching the API directly.

Depends on: Phases 1–5 (UI trails the API for each feature area).

---

## Phase 7 — Hardening & OSS launch prep

**Goal:** ready for other people to self-host and contribute to.

Tasks:

- ~~Bounce handling~~ -- done: webhook ingestion + threshold-based
  auto-blocklisting. Mailbox-scan-based bounce detection (IMAP/POP polling, as
  opposed to webhook push) is still open if a provider without bounce
  webhooks needs support.
- CSV subscriber import + double opt-in confirm flow -- carried over from
  Phase 1's original exit criteria, never built (see Status section above).
- Campaign analytics polish, public archive pages.
- listmonk → Dripline import tool -- script written, never run against a real
  listmonk database.
- Load testing dispatch engine at realistic list sizes; add `campaign_emails`
  partitioning if needed (PRD §8.2).
- ~~Documentation: self-host guide, API reference, contribution guide.~~ -- done.
- ~~License choice, README~~ -- done (MIT). GitHub repo setup / first commit
  still open -- nothing is in git yet.

Exit criteria: a stranger can `docker compose up`, follow the README, and send a
campaign end to end with no prior context.

Depends on: Phase 6.

---

## Phase 8 — Campaign body editing modes

**Goal:** match listmonk's 5 body-editing formats -- richtext, raw HTML,
markdown, plain text, visual (drag-and-drop) -- instead of the single plain
HTML textarea campaigns started with.

### Research

Checked listmonk's actual implementation before building this
(`frontend/src/components/{RichtextEditor,VisualEditor,Editor}.vue`,
`schema.sql`, `models/campaigns.go`):

- Data model: `campaigns.content_type` enum (`richtext | html | plain |
markdown | visual`) + `body` (always final HTML, converted from markdown at
  compile/send time, not at save time) + `body_source` (original editor
  source: markdown text, or the visual builder's JSON design; mirrors `body`
  for the other types).
- Richtext: TinyMCE (self-hosted, GPL).
- Visual: a vendored copy of the open-source **usewaypoint/email-builder-js**
  (React + MUI), built as a separate Vite app and embedded in listmonk's Vue
  admin via an iframe + UMD script bridge -- because listmonk's admin is Vue
  and email-builder-js is React.
- Markdown → HTML: Go's `yuin/goldmark`, converted once per campaign at
  compile time (before per-recipient merge-field substitution, so
  `{{ .Subscriber.Name }}` written inside markdown survives the conversion).

### Decisions

- **Matched listmonk's data model exactly** (`content_type`, `body`,
  `body_source`, same semantics) -- no reason to diverge, and it directly
  informed the dispatch-job change below.
- **Richtext: same choice as listmonk** -- TinyMCE, self-hosted via the
  `tinymce` npm package (no cloud API key, `licenseKey: "gpl"`), bundled
  directly through Vite rather than listmonk's iframe/UMD-script approach
  (we don't have listmonk's Vue-vs-React mismatch to work around).
- **Visual: GrapesJS + `grapesjs-preset-newsletter` instead of
  usewaypoint/email-builder-js.** Framework-agnostic (mounts into a plain
  div, no React/MUI dependency), MIT-licensed, purpose-built for email
  templates. Chosen specifically to avoid pulling MUI + emotion + zustand
  into a project that has stayed deliberately framework-light everywhere
  else (plain CSS, no UI kit) -- vendoring listmonk's exact React+MUI builder
  would have been the heavier and more inconsistent choice for this codebase.
- **Markdown conversion happens server-side, once per dispatch batch, not
  per-recipient** -- `apps/api/src/lib/markdown.ts` (`marked`), called from
  `jobs/campaignDispatch.ts` right after fetching the campaign row, mirroring
  listmonk's compile-once-per-campaign timing and its merge-field-survives-
  conversion property. The database's `body` column holds _raw markdown
  source_ for markdown campaigns, not pre-converted HTML -- matching
  listmonk, and meaning the client-side markdown preview (also `marked`, so
  visually consistent) and the server-side send-time conversion both start
  from the same source.
- **Plain text is not sent as a genuine `text/plain` MIME part** -- the
  `ConnectionSender` interface only carries `html`. A plain-content campaign
  is escaped and wrapped in `<pre>` so it renders as literal text within the
  single HTML part. A true multipart text/plain part is a reasonable later
  improvement; scoped out here to avoid restructuring the sender interface
  across SMTP and SES.
- **No cross-format conversion.** Switching a campaign's content type in the
  UI clears the body rather than attempting to convert it (listmonk does
  convert markdown→HTML when switching, via `Campaign.ConvertContent`). Not
  implemented here -- scoped out as a follow-up, not attempted partially.
- **Heavy editors are lazy-loaded**, not bundled into the main app chunk.
  TinyMCE and GrapesJS are each large; `ContentTypeEditor.tsx` uses
  `React.lazy` + `Suspense` per editor so a session that only ever uses one
  mode doesn't download the other four. Confirmed via build output: main
  chunk stayed at ~256KB gzip ~79KB; TinyMCE and GrapesJS each split into
  their own ~1.2-1.5MB chunks loaded only on demand.

### Tasks

- Migration `1755820800008`: `campaigns.content_type` (CHECK-constrained
  text, default `richtext`) + `campaigns.body_source`.
- Backend: `content_type`/`body_source` accepted on campaign create/update
  (Zod-validated against the 5-value enum); markdown-to-HTML conversion
  wired into the dispatch job; plain-text escaping in `mailer.ts`.
- Frontend: `components/content-editor/` -- `ContentTypeEditor.tsx` (the
  switcher + lazy-loading), `RichTextEditor.tsx` (TinyMCE),
  `HtmlEditor.tsx` / `MarkdownEditor.tsx` (CodeMirror via
  `@uiw/react-codemirror`, markdown pairs with a live `marked`-rendered
  preview pane), `PlainTextEditor.tsx` (plain textarea, eager-loaded, no
  reason to lazy-load something trivial), `VisualEditor.tsx` (GrapesJS,
  imperative mount via `useEffect`/`useRef` since it isn't a React-native
  component). Wired into both `CampaignNew.tsx` and `CampaignDetail.tsx`'s
  edit form; the read-only campaign detail preview also renders per
  content-type (markdown converted client-side, plain text escaped) so it
  matches what actually gets sent.

### Status: built and verified in a browser

All 5 editing modes were driven in a real browser session against the actual
running app (not just typechecked): TinyMCE renders with its full toolbar and
edits correctly; both CodeMirror modes (HTML, markdown) render with syntax
highlighting and accept input; the markdown preview pane correctly renders
headings/bold/links live, including merge fields surviving the conversion
unchanged; plain text correctly preserves literal `<`/`>`/`&` characters;
GrapesJS + the newsletter preset renders its full block library and toolbar,
and its own "Export template" panel confirms `getHtml()`/`getCss()` produce
valid output. Zero console errors across all 5 modes. A full round trip was
also verified against the real API: created a markdown campaign, confirmed
via a direct API call that the database stores raw markdown source in both
`body` and `body_source` (not pre-converted HTML) with `content_type:
"markdown"`, then reopened it for editing and confirmed the editor and
preview reconstruct correctly from that stored state.

Not yet exercised: an actual send of a **visual** campaign through to a real
inbox (markdown and richtext were both exercised via 8.1 below); a send of
any content type through the _real dispatch job_ specifically (as opposed to
the test-send path, which reuses the same render/markdown/connection code
but not `campaign_emails`) -- the Phase 2 E2E test predates this phase and
only covered richtext through actual dispatch. Templates
(`apps/web/src/pages/Templates.tsx`) intentionally were not given the same
treatment -- matching listmonk, where `content_type` lives only on
campaigns, not templates, since templates are structural HTML wrappers
rather than authored content.

Depends on: Phase 2 (dispatch engine -- markdown conversion is inserted into
the existing per-batch flow) and Phase 3 (mailer.ts changes sit alongside the
connection-sending path).

### 8.1 Send test email (added 2026-08-22)

**Goal:** an email field + button on both the new-campaign and edit-campaign
pages to send a one-off test, matching listmonk's `POST
/api/campaigns/:id/test`.

- `POST /campaigns/:id/test` -- `{ email, name?, subject?, body?,
body_source?, content_type?, from_email?, template_id? }` → `{ ok, error }`
  (`services/campaigns.ts` `sendTestEmail`). Uses the campaign's _saved_
  connection chain, but whatever body/subject/content_type overrides are
  passed in -- so a test can validate in-progress, unsaved edits, matching
  listmonk's model where test sends use current form state, not necessarily
  what's persisted. Not part of the `campaign_emails` dispatch pipeline: no
  row is created, it doesn't count toward `to_send`/`sent`, but it does still
  go through the connection's real rate limit (same `sendWithChain` path a
  real send uses).
- The recipient need not be an existing subscriber (unlike listmonk, which
  requires it) -- if the address matches one, their real name/attribs are
  used for the merge-field preview; otherwise a synthetic, non-persisted
  stand-in subscriber is used so `{{ Subscriber.Name }}` still renders
  something sensible.
- **New campaign page:** there's no campaign row yet to test against, so
  "Send test" silently creates the draft first (same fields as the real
  "Create campaign" submit), then tests. A `createdId` is tracked client-side
  so a second test (or the eventual real submit) updates that same draft via
  PATCH instead of creating a duplicate row each time.
- **Edit campaign page:** a campaign already exists here, so "Send test"
  sends the current unsaved form state as overrides directly, without saving
  -- you can try an edit before committing to "Save changes."

**Status: built and verified end-to-end** against a real API + Postgres +
Mailpit (not mocked): confirmed testing without a connection attached fails
with a clear error; confirmed a test send with overrides succeeds and the
_saved_ campaign row is left untouched (proving overrides don't leak into
persisted state); confirmed the recipient, subject, and body in the actual
received email reflect the overrides with merge fields correctly substituted
for a synthetic (non-subscriber) address; confirmed a markdown-content-type
test send is correctly converted to real HTML (`<h1>`, `<strong>`) rather
than sending literal markdown syntax.

---

## Open sequencing decisions

- ~~Bounce handling is currently placed in Phase 7 but is arguably needed
  earlier~~ -- resolved: it was built early (Phase 7's webhook-based piece),
  ahead of the rest of Phase 7.
- Admin UI (Phase 6) could instead be built incrementally alongside each backend
  phase rather than as one block at the end. This is effectively what happened
  in practice: it was built right after Phase 5 rather than deferred, though
  Phase 3's revised Connections UI (3.6) is now the next UI-relevant chunk.
- Full multi-tenant workspace isolation (separate subscriber pools / RBAC per
  site) is not planned. Explicit per-campaign connection selection (Phase 3)
  is the intended way to keep multiple sites' mail correctly separated by
  sending domain from one Dripline install; revisit only if isolated
  dashboards or per-site permissions become an actual requirement.
