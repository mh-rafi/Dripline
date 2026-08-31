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

## Changing a campaign's lists after it has started

The recipient set is materialized into `campaign_emails` when a campaign starts, so
editing its lists afterwards has to reconcile that queue -- the rows do not follow
`campaign_lists` on their own. Editing is allowed while `draft`, `scheduled` or `paused`;
`running` is rejected (`setCampaignLists` in `services/campaigns.ts`), because the
dispatch worker is claiming batches concurrently and the set would be edited out from
under an in-flight tick. Pause first.

- **Adding a list** takes effect on the next start/resume: `enqueueEligibleRecipients`
  runs again and inserts rows for its members. `ON CONFLICT DO NOTHING` means nobody
  already mailed is mailed twice.
- **Removing a list** prunes immediately, in the same transaction as the list change.
  Only `pending` rows go -- `sent`/`failed`/`skipped` are history and `queued` is already
  in flight. The test is not "was this contact on the removed list" but "is this contact
  still eligible through a list the campaign has", so someone on two of the campaign's
  lists survives the removal of one.

`eligibleRecipientIds()` is the single definition of who belongs in the queue, shared by
the enqueue and the prune so the two can't drift apart.

Verified against real Postgres with four contacts (one on the removed list only, one on
both, one on the kept list only, one already `sent`): only the first was pruned, the
already-sent row survived, re-adding the list brought its member back on resume without
re-mailing anyone, and editing while `running` was rejected.

**Known gap, not addressed here:** `claimBatch` does not re-check eligibility, and the
prune only runs on a list change. A contact who unsubscribes or is blocklisted _while a
campaign is paused_ still has a `pending` row and is still mailed on resume. Closing that
means running the same prune at resume -- a deliberate behavioral decision about who gets
mail, not just a queue cleanup, so it is called out rather than done quietly.
