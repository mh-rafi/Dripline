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
- ~~License choice, README~~ -- done: relicensed from MIT to **AGPL-3.0-or-later** before
  the repo had any outside contributors, so the switch needed nobody's permission. AGPL
  does not stop a competitor from running Dripline as a SaaS (it only forces them to
  publish modifications) -- the levers for that are the trademark reservation in `NOTICE`
  and the contributor grant in `CONTRIBUTING.md`, which keeps selling commercial licenses
  possible. Section 13's source offer is served by `GET /api/v1/meta` and linked from the
  admin UI sidebar; a modified deployment sets `SOURCE_URL` to its own source.
- ~~Deployable by someone who isn't us~~ -- done: one container image serving API, workers
  and admin UI, migrations applied at start, Compose files for a plain VPS / Dokploy-style
  PaaS / bundled Caddy, plus systemd and bare-image paths. Startup now fails closed on the
  published development secrets. See [../deployment.md](../deployment.md).

**Exit criteria:** a stranger can `docker compose up`, follow the README, and send a
campaign end to end with no prior context. -- The install half is done and verified
(`docker compose up -d` on a filled-in `.env` yields a working, migrated, healthy
instance); the send half still depends on their own SMTP credentials.

**Depends on:** Phase 6.
