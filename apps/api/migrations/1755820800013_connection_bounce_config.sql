-- Per-connection bounce-mailbox (IMAP) scanning config. See
-- docs/plan/mailbox_bounce_scanning.md for why this lives on connections
-- rather than a global setting.
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bounce_config JSONB;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bounce_last_uid INTEGER;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bounce_last_uidvalidity BIGINT;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bounce_error_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bounce_disabled_reason TEXT;
