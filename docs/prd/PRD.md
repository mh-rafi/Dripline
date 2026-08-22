# Dripline — Product Requirements Document

Status: Draft v0.1
Owner: uilib.help@gmail.com
Last updated: 2026-08-21

## 1. Summary

Dripline is an open-source, self-hosted email marketing platform: newsletters/broadcast
campaigns plus automation (drip sequences, event-triggered workflows) and multi-provider
sending. It is inspired by [listmonk](https://github.com/knadh/listmonk) — keeping the
things that work well (external API, templating, per-campaign rate limiting/sliding
window, self-hosted single-tenant model) — while addressing gaps that listmonk does not
cover and a delivery-tracking design flaw found in listmonk's checkpoint-based sender.

## 2. Background / Problem Statement

While operating a listmonk instance in production, a campaign was found to have stopped
sending partway through its recipient list and been marked `finished`, despite hundreds
of eligible subscribers never receiving the email.

Root cause, in short: listmonk tracks send progress with a single `last_subscriber_id`
checkpoint per campaign, advanced **at batch-fetch time** rather than at delivery
confirmation. Under a large batch size and a slow sliding-window rate limit, a large
chunk of recipients gets marked "handled" long before they're actually emailed. Any
interruption during that window — pause, restart, or a list membership change —
permanently strands the unsent portion: the checkpoint has already moved past them, so
they are silently skipped and never retried, and the campaign reports `finished`.

Separately, listmonk does not support:

- Drip sequences (time-delayed email series relative to a trigger, e.g. "3 days after
  signup").
- Event-based automation triggers (e.g. "subscriber tagged X", "webhook received",
  "link clicked → enroll in sequence").
- Multiple sending providers load-balanced/failed-over for a single logical "from"
  identity.

## 3. Goals

1. Preserve delivery-tracking correctness: know, per recipient, whether a send
   succeeded, failed, or is pending — recoverable across restarts/crashes.
2. Support automations: trigger → condition(s) → delayed/branching steps → action(s),
   with per-contact state tracking.
3. Support event-based triggers (webhook ingestion, in-app events, list/tag changes).
4. Support multiple sending providers per instance, with routing/failover/weighting.
5. Keep the good parts of listmonk: external HTTP API, subscriber/list management,
   templating, per-campaign message-rate and sliding-window throttling, self-hosted
   simplicity (minimal number of services to run).
6. Ship as open source, easy to self-host (Docker Compose, single Postgres dependency
   plus the app — no Redis requirement).

## 4. Non-Goals (v1)

- Multi-tenant / SaaS billing.
- listmonk's checkpoint-based (row-less) dispatch mode. The interface should not
  preclude adding it later, but it will not be built in v1 (see §8.3).
- Full multi-tenant workspace isolation (separate subscriber pools, RBAC per
  site/brand). Explicit per-campaign connection selection (§6.3) is the
  intended way to run multiple SaaS products/domains from one Dripline
  install without their mail mixing sending identities -- not a reason to
  build isolated tenancy. Revisit only if isolated dashboards/permissions
  become an actual requirement.
- A/B testing, send-time optimization, deliverability scoring — future consideration.
- Prisma or any full ORM — raw SQL / a lightweight query builder only, to keep the stack
  lean and keep full control over the hot batch-dispatch queries.

## 5. Tech Stack

| Layer                 | Choice                         | Notes                                                                                                                                             |
| --------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language              | Node.js + TypeScript           | Team's strongest language; I/O-bound workload (DB + SMTP), not CPU-bound, so Go's throughput edge is not a deciding factor here.                  |
| API framework         | Fastify                        | Lighter/faster than Express, good TS support.                                                                                                     |
| Database              | PostgreSQL                     | Single source of truth; same choice as listmonk.                                                                                                  |
| Data access           | Raw SQL / Kysely (TBD)         | No Prisma — Prisma's batch-query performance has been a weak point for the exact `id > checkpoint LIMIT n`-style hot paths this app depends on.   |
| Job queue / scheduler | pg-boss                        | Postgres-backed durable queue — avoids adding Redis as a second service; gives crash-safe, retryable jobs for both one-off sends and drip delays. |
| Frontend              | React + TypeScript             | Admin UI (campaigns, lists, automations builder, templates).                                                                                      |
| Email transport       | Nodemailer                     | Wrapped by an internal provider-router layer for multi-provider support.                                                                          |
| Deployment            | Single Node process + Postgres | Docker Compose for self-host; no Redis, no separate broker.                                                                                       |

## 6. Feature Set

### 6.1 Carried over from listmonk (parity)

- Subscribers, lists (single/double opt-in), tags/attributes.
- Broadcast campaigns with rich-text/plain templates, template inheritance.
- Public HTTP API for external services to create/query subscribers, trigger sends.
- Per-campaign message rate limiting and sliding-window throttling.
- Bounce handling (webhook + mailbox scan), blocklisting.
- Campaign analytics: opens, clicks, views.
- Archive / public campaign pages.

### 6.2 New: Automations (drip + event-based)

- **Trigger types (v1):** subscriber added to list, tag applied, webhook received,
  campaign link clicked, manual enrollment via API.
- **Workflow steps:** delay (relative offset), condition/branch (attribute or event
  based), send-email action, add/remove tag or list action, webhook-out action.
- **Per-contact state:** every contact enrolled in a workflow has a row tracking their
  current step and next-run timestamp — scheduled via pg-boss delayed jobs, not polling.
- **Re-entry rules:** configurable — allow/deny a contact re-entering a workflow they've
  already completed or are currently in.

### 6.3 New: Multi-provider sending ("connections")

- Multiple sending connections configurable per instance, each a distinct
  credential/domain identity. v1 provider types: generic SMTP (full TLS mode /
  auth method / skip-verify control) and AWS SES. Designed so additional
  provider types (Postmark, SendGrid, Mailgun, ...) are new implementations of
  one sender interface, not a redesign.
- **Selection is explicit, not an automatic pool.** A campaign (or a
  workflow's `send_email` step) chooses one primary connection plus an
  optional, user-ordered list of fallback connections. There is no implicit
  "route across all enabled connections" behavior -- this matters for running
  multiple SaaS products/domains from one instance, where automatically
  routing a campaign through the wrong domain's connection would break
  SPF/DKIM alignment and mix sending reputations.
- **Rate limiting lives on the connection, enforced globally.** Each
  connection has a send-rate cap (count per duration) that's the real
  provider-imposed constraint (SES account limits, an SMTP relay's own rate
  cap) -- it's enforced across _all_ campaigns/workflows concurrently using
  that connection, via an atomic shared counter, not per-campaign. A
  campaign-level throttle remains available as an optional secondary cap that
  can only slow a send down further, never exceed the connection's limit.
- Test-connection support (verify credentials/reachability before trusting a
  connection with a real campaign), and full add/edit forms in the admin UI.
- Per-connection health/error tracking; auto-disable after a configurable
  consecutive-failure threshold, matching listmonk's `max_send_errors` concept
  but scoped per-connection.

## 7. Data Model (high-level, subject to change)

Core tables (broadly listmonk-compatible naming where it maps 1:1):
`subscribers`, `lists`, `subscriber_lists`, `campaigns`, `templates`, `media`.

New/changed for Dripline:

- **`campaign_emails`** — one row per (campaign_id, subscriber_id): `status`
  (`pending` | `queued` | `sent` | `failed` | `skipped`), `connection_id`, `error`,
  `sent_at`, `updated_at`. This replaces listmonk's checkpoint; it is the source of
  truth for "who has received this campaign."
- **`workflows`** — automation definitions (trigger config, steps as ordered/graph
  structure); a `send_email` step carries its own connection selection.
- **`workflow_enrollments`** — one row per (workflow_id, subscriber_id): current step,
  status, next_run_at.
- **`workflow_events`** — raw event log feeding trigger evaluation (webhook payloads,
  in-app events).
- **`connections`** — sending connection configs (SMTP or SES), `from_email`/
  `from_name`/`label`, TLS/auth fields, and `rate_limit_count` +
  `rate_limit_duration_seconds` (the authoritative, globally-enforced send-rate
  cap for that connection).
- **`campaign_connections`** — `(campaign_id, connection_id, priority)`: the
  explicit, user-ordered primary + fallback chain a campaign sends through.
  No implicit "all enabled connections" pool.

## 8. Architecture Notes

### 8.1 Dispatch model

Starting a campaign inserts one `campaign_emails` row per eligible recipient
(batched `INSERT`, not one-by-one) with `status = pending`. A pg-boss worker pool then
claims `pending` rows in batches, attempts delivery, and updates each row's status
**after** the provider confirms accept/reject — never before. This is the direct fix
for the listmonk failure mode in §2: progress is tracked per recipient, so a crash or
pause loses at most the in-flight batch's _in-progress_ rows, all of which remain
`pending`/`queued` and are automatically retried on resume.

### 8.2 Scale considerations

Row-per-recipient at very large list sizes (multi-million) is the known cost of this
model. Mitigations, not required for v1 but should not be architecturally precluded:

- Batch-insert via multi-row `INSERT`/`COPY`.
- Index on `(campaign_id, status)`.
- Partition `campaign_emails` by `campaign_id` or time if/when needed.

### 8.3 Future: pluggable dispatch strategy

The sender should sit behind a `DispatchStrategy` interface so a listmonk-style
checkpoint mode could be contributed later for users who want the lower-storage-cost
tradeoff for pure-broadcast (non-automation) sends. Not built in v1 — automations
inherently require per-contact state, so the row-per-recipient model is mandatory for
at least that part of the product regardless.

## 9. Open Questions

- Kysely vs. hand-written SQL + a thin query layer — decide before schema/migration
  tooling is set up.
- Workflow step definition format: DB-normalized graph vs. JSON step list (affects
  builder UI complexity vs. query-ability).
- Webhook trigger auth/signing scheme.
- Migration path / import tooling from an existing listmonk instance (subscribers,
  lists, templates) — likely wanted given the project's origin.

## 10. Milestones (draft)

1. Core data model + subscriber/list CRUD + API parity subset.
2. Broadcast campaigns with `campaign_emails` dispatch + pg-boss sending workers.
3. Multi-provider routing.
4. Automations v1 (delay + send-email steps, list/tag triggers).
5. Event-based triggers (webhook ingestion) + condition branching.
6. Admin UI (React) for all of the above.
