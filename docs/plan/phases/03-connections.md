# Phase 3 — Connections: multi-domain sending, explicit selection, rate limits

## Why this was redone

The original Phase 3 built a single implicit pool: every enabled provider was
weighted-random-selected for every send, with automatic failover across all of them. Wrong
for a real deployment running multiple SaaS products/domains from one Dripline instance --
it could silently send SaaS A's campaign through SaaS B's connection, mixing sending
domains and breaking SPF/DKIM/reputation alignment. Also missing fields real SMTP setups
need (TLS mode, auth method, skip-verify), a test-before-trust flow, an edit form, AWS SES
support, and rate limiting beyond a flat per-campaign `messages_per_minute`.

This phase replaced the `providers` model with `connections` and made selection
**explicit** everywhere a send happens.

## Key decisions

- **Rate limiting lives primarily on the connection, not the campaign.** A connection's
  send-rate cap is a property of the provider account/credential itself (SES account
  limits, an SMTP relay's cap) -- it must be enforced globally across every campaign/
  workflow currently sending through it, not per-campaign, or concurrent campaigns on the
  same connection could together exceed what the provider allows. Campaign-level
  throttling stays available as an optional, secondary, additional cap (can only slow a
  campaign down further, never exceed the connection's own limit).
- **No implicit pooling.** A campaign (or workflow `send_email` step) selects one
  connection as primary, with an optional explicit ordered fallback list. No "all enabled
  connections" automatic pool.
- **Two connection types for v1:** `smtp` and `ses` (AWS SES via `@aws-sdk/client-sesv2`).
  More provider types (Postmark, SendGrid, Mailgun) are a natural later addition -- keep
  `ConnectionSender` generic enough that they're new implementations, not a redesign.
- **Multi-SaaS / multi-site usage:** explicit per-campaign connection selection keeps each
  site's mail on its own domain correctly -- full multi-tenant workspace isolation
  (separate subscriber pools, RBAC per site) is explicitly out of scope. Lists/tags segment
  audiences per site. Revisit only if isolated dashboards or per-site permissions become an
  actual requirement.

## What was built

- **Data model:** `providers` → `connections`; expanded config by type (`smtp`: host,
  port, `tls_mode`, `tls_skip_verify`, `auth_method`, username, password; `ses`: region,
  access key/secret or IAM role); `rate_limit_count`/`rate_limit_duration_seconds` on
  connections; `campaign_connections` join table (`campaign_id, connection_id, priority`)
  for ordered fallback chains; equivalent `connection_id` + fallback list on the
  `send_email` workflow step.
- **Sender abstraction:** `ConnectionSender` interface (`send`, `verify`); `SmtpSender`
  rebuilt on the new TLS/auth fields; `SesSender` via `@aws-sdk/client-sesv2`;
  `getSenderFor(connection)` factory.
- **Connection-level rate limiter:** `services/rateLimiter.ts`'s `reserveRateLimitSlots`,
  a single atomic SQL statement safe under concurrent claimers, shared by both campaign
  dispatch and workflow `send_email`.
- **Explicit routing:** dispatch resolves a campaign/workflow's own configured connection
  chain (primary, then fallbacks in priority order) instead of querying "all enabled
  connections." A rate-limited/disabled connection is skipped in favor of the next one in
  _that campaign's own chain_ -- never a connection it didn't list.
- **Test connection:** `POST /connections/test` (unsaved draft config) and
  `POST /connections/:id/test` (saved) -- SMTP `transporter.verify()`, SES a lightweight
  credentials check.
- **UI:** Connections page with type-specific add/edit forms (edit was previously missing
  entirely), "Test connection" button, campaign connection picker (primary + fallbacks).
- **Campaign throttle generalization (2026-08-22):** the original per-campaign
  `messages_per_minute` was tied to the dispatch scan's fixed 1-minute cadence, so nothing
  slower than "per minute" was expressible. Replaced with the same
  `rate_limit_count`/`rate_limit_duration_seconds`/`window_start`/`window_count` shape
  connections use (migration `1755820800007`), sharing `reserveRateLimitSlots` (table-
  generic over `connections` | `campaigns`). A shared `DurationInput` component (number +
  seconds/minutes/hours dropdown) replaced raw "seconds" fields in the UI.

## Status: built — 3 real bugs found via code review and fixed

1. **Rate limiter race condition** -- `reserveRateLimitSlots` used `db.connection()`
   instead of `db.transaction()`, so the `SELECT ... FOR UPDATE` row lock wasn't actually
   held across the check-then-increment. Reproduced directly: 20 concurrent calls against a
   limit of 5 granted 19. Fixed and reverified: exactly 5.
2. **`PATCH /campaigns/:id` rejected `template_id: null`** -- the Zod schema only accepted
   `number | undefined`, but the edit UI needs to send `null` to clear the template. Fixed
   with `.nullable()`.
3. **Workflow `send_email` steps with no `connection_id` silently used "the first enabled
   connection"** -- directly contradicting this phase's "no implicit pooling" principle.
   Now sends nothing until a connection is actually named on the step; the step engine also
   retries on `rate_limited` instead of silently advancing past it.

## Exit criteria

- [x] Two SMTP connections + one SES connection, each with a different sending domain.
- [x] A campaign with only Connection A selected sends exclusively through A, even while B
      is enabled and otherwise eligible -- by construction.
- [x] A connection's rate limit is honored when two campaigns send through it
      concurrently -- verified (see bug #1 above).
- [x] Test-connection reports failure on bad credentials, success on good ones (endpoint
      implemented; not re-verified against live bad/good AWS credentials).
- [x] Editing an existing connection's host/port/credentials persists, including the
      secret-preserving merge-on-patch (blank password = "keep current").

**Depends on:** Phase 2 (changes how dispatch picks a connection, not the row-per-recipient
model itself).
