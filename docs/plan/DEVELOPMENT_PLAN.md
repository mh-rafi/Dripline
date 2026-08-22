# Dripline — Development Plan

Status: Draft v0.2 (revised)
Last updated: 2026-08-22
Companion doc: [../prd/PRD.md](../prd/PRD.md)

This plan sequences the work in [PRD.md](../prd/PRD.md) into phases. Each phase has a
goal, concrete tasks, an exit criteria (what "done" means, testable), and its
dependencies on earlier phases. Phases are meant to be built roughly in order —
automations (Phase 4) specifically depend on the dispatch engine from Phase 2.

**v0.2 revision (2026-08-22):** Phases 0, 1, 2, and 4 have a working, E2E-tested
implementation (see [Status](#status-as-of-2026-08-22) below for exactly what's
verified vs. not). Phase 3 (multi-provider sending) is being **redone** based on
real usage requirements that the original design didn't account for — see
"Why Phase 3 is being redone" below before reading its new task list.

---

## Status as of 2026-08-22

**Built and verified end-to-end** (real Postgres + a local SMTP catcher, not
mocks): Phase 0 scaffolding; Phase 2 campaigns/dispatch engine (personalized
sends, open/click/unsubscribe tracking, pause-mid-send-then-resume without
losing or duplicating recipients); Phase 4 drip automations (multi-step
delayed sequence, verified through completion); bounce-triggered
auto-blocklisting (Phase 7).

**Built but not yet verified:** Phase 1's core CRUD is solid, but its original
exit criteria (CSV import, a double opt-in confirm email/link flow) were never
built -- only JSON bulk import exists today, and `unconfirmed` subscribers on
double opt-in lists have no way to become `confirmed`. Phase 5's webhook
ingestion and `link_clicked` triggers exist in code but have never been
exercised end-to-end. Phase 6's admin UI builds and typechecks but has never
been driven in an actual browser -- all verification so far has gone through
the HTTP API directly.

**Explicitly not done:** the original Phase 3 (multi-provider) is being
replaced -- see below. Public archive pages, load testing at scale, and
running the listmonk import script against a real listmonk database are all
still open (Phase 7). Nothing is committed to git yet.

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

### Exit criteria

- Create two SMTP connections and one SES connection, each with a different
  sending domain.
- A campaign with only Connection A selected sends exclusively through A, even
  while Connection B is enabled and otherwise eligible.
- A connection's rate limit is honored correctly when two campaigns are
  sending through it at the same time (combined throughput never exceeds the
  configured limit).
- Test-connection correctly reports failure on bad credentials and success on
  good ones, for both SMTP and SES.
- Editing an existing connection's host/port/credentials actually persists
  (today it silently can't be done from the UI at all).

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
