-- Per-connection provider-API bounce polling, for senders with neither
-- bounce webhooks nor a mailbox to scan (e.g. Mail.Baby). A third ingestion
-- path into the same recordBounce() the webhook and IMAP scan use -- see
-- apps/api/src/bounceProviders/.
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bounce_poll_config JSONB;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bounce_poll_error_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bounce_poll_disabled_reason TEXT;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bounce_poll_last_run_at TIMESTAMPTZ;

-- A poll re-reads the same provider log rows on every tick (a row's delivery
-- status changes in place, so a simple cursor would miss late failures); this
-- is what makes recording one idempotent. NULLs stay distinct, so the webhook
-- and IMAP paths, which set none, are unaffected.
ALTER TABLE bounces ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bounces_dedupe_key ON bounces(dedupe_key);
