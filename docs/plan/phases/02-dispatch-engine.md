# Phase 2 — Broadcast campaigns + dispatch engine

**Goal:** send a campaign correctly and durably — the row-per-recipient model that fixes
listmonk's checkpoint bug, and the foundation automations reuse.

Tasks:

- Migrations: `campaigns`, `campaign_emails` (per-recipient dispatch table), `providers`.
- Campaign creation: target list(s), template, schedule/send-now.
- On campaign start: batched `INSERT` of one `campaign_emails` row per eligible recipient
  (`status = pending`).
- pg-boss worker(s): claim `pending`/`queued` rows in batches, send via Nodemailer, update
  row status **only after** provider response (`sent` / `failed`), never before.
- Per-campaign send-rate limiting.
- Pause/resume/cancel: pausing stops claiming new rows; in-flight rows finish or are safely
  requeued, nothing already `pending` is lost.
- Live campaign progress view, sourced from `campaign_emails`, not a cached counter.
- Retry policy for `failed` rows.

**Exit criteria:** start a campaign, kill the app process mid-send, restart it — sending
resumes and completes with zero recipients silently skipped. Verified by comparing
`campaign_emails` row count to list size before/after.

**Depends on:** Phase 1.

**Status: built and verified end-to-end** (real Postgres, local SMTP catcher, real
browser): personalized sends, open/click/unsubscribe tracking, pause-mid-send-then-resume
without losing or duplicating recipients.
