-- Captures the outgoing Message-ID at send time, so a later bounce (parsed
-- from a bounce mailbox scan -- see docs/plan/mailbox_bounce_scanning.md)
-- can be matched back to the exact campaign_emails row it came from.
ALTER TABLE campaign_emails ADD COLUMN IF NOT EXISTS message_id TEXT;
CREATE INDEX IF NOT EXISTS idx_campaign_emails_message_id ON campaign_emails(message_id)
  WHERE message_id IS NOT NULL;
