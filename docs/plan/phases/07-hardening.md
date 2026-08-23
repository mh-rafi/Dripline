# Phase 7 — Hardening & OSS launch prep

**Goal:** ready for other people to self-host and contribute to.

Tasks:

- ~~Bounce handling~~ -- done: webhook ingestion + threshold-based auto-blocklisting.
  Mailbox-scan-based bounce detection (IMAP/POP polling) is still open for providers
  without bounce webhooks.
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
