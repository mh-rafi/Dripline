# Phase 7 — Hardening & OSS launch prep

**Goal:** ready for other people to self-host and contribute to.

Tasks:

- ~~Bounce handling~~ -- done: webhook ingestion + threshold-based auto-blocklisting, plus
  per-connection IMAP mailbox-scan detection for providers without bounce webhooks -- see
  [../mailbox_bounce_scanning.md](../mailbox_bounce_scanning.md) (built; not yet verified
  against a real mailbox or clicked through in the browser). Designed specifically to avoid
  the crash listmonk's own POP-based scanner hit against a large mailbox: per-connection UID
  cursor + a hard `max_age_days`/`max_messages_per_scan` bound, IMAP-only (no POP), never
  marks mail read/moved/deleted. Also supports a genuinely separate bounce mailbox via an
  envelope-from (Return-Path) override, not a custom header.
  We'll implement webhook handler for AWS SES, Resend and others later.

- ~~CSV subscriber import~~ -- done (Phase 1). Double opt-in confirm flow is still open.
- Campaign analytics polish, public archive pages.
- listmonk → Dripline import tool -- script written, never run against a real listmonk
  database.
- Load testing dispatch engine at realistic list sizes; `campaign_emails` partitioning if
  needed.
- ~~Documentation: self-host guide, API reference, contribution guide.~~ -- done.
- ~~License choice, README~~ -- done (MIT). GitHub repo setup / first commit still open.

**Exit criteria:** a stranger can `docker compose up`, follow the README, and send a
campaign end to end with no prior context.

**Depends on:** Phase 6.
