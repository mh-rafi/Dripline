-- Phase 3: connections. Replaces the weighted "providers" pool with explicit,
-- per-campaign connection selection (primary + ordered fallbacks) plus a
-- per-connection, globally-enforced send-rate cap. See docs/plan/DEVELOPMENT_PLAN.md §Phase 3.

-- 1. Rename providers -> connections and expand the schema.
ALTER TABLE providers RENAME TO connections;

-- type now also covers AWS SES (additional provider types are a later addition).
ALTER TABLE connections DROP CONSTRAINT IF EXISTS providers_type_check;
ALTER TABLE connections ADD CONSTRAINT connections_type_check CHECK (type IN ('smtp', 'ses'));

-- Display name for the From header (optional).
ALTER TABLE connections ADD COLUMN IF NOT EXISTS from_name TEXT NOT NULL DEFAULT '';

-- Per-connection send-rate cap: at most `rate_limit_count` sends per
-- `rate_limit_duration_seconds`. NULL/0 means unlimited. Enforced globally
-- across every campaign/workflow using the connection (see connectionRateLimiter).
ALTER TABLE connections ADD COLUMN IF NOT EXISTS rate_limit_count INTEGER;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS rate_limit_duration_seconds INTEGER;

-- Fixed-window rate-limit state, updated under a row lock by tryAcquireSendSlot.
ALTER TABLE connections ADD COLUMN IF NOT EXISTS window_start TIMESTAMPTZ;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS window_count INTEGER NOT NULL DEFAULT 0;

-- No implicit weighted pool anymore.
ALTER TABLE connections DROP COLUMN IF EXISTS weight;

-- Normalize any pre-existing smtp config rows into the new shape (best-effort;
-- no-op on a fresh install with no rows). Derive tls_mode/auth_method from the
-- legacy secure/username fields so old connections keep working after the rename.
UPDATE connections
SET config =
    COALESCE(config, '{}'::jsonb)
    || jsonb_build_object(
      'tls_mode',
      CASE WHEN (config ->> 'secure')::boolean THEN 'tls' ELSE 'starttls' END,
      'tls_skip_verify',
      false,
      'auth_method',
      CASE WHEN COALESCE(config ->> 'username', '') = '' THEN 'none' ELSE 'login' END
    )
WHERE type = 'smtp';

-- 2. campaign_emails.provider_id -> connection_id (the FK follows the table rename).
ALTER TABLE campaign_emails RENAME COLUMN provider_id TO connection_id;

-- 3. Explicit, user-ordered primary + fallback chain per campaign.
CREATE TABLE campaign_connections (
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (campaign_id, connection_id)
);
CREATE INDEX idx_campaign_connections ON campaign_connections(campaign_id, priority);

-- 4. Carry over existing campaigns: the old behavior sent through the pool of
-- all enabled providers, so map each existing campaign onto every enabled
-- connection as an ordered fallback chain (priority by connection id).
INSERT INTO campaign_connections (campaign_id, connection_id, priority)
SELECT c.id, con.id, ROW_NUMBER() OVER (ORDER BY con.id)
FROM campaigns c
CROSS JOIN connections con
WHERE con.enabled = true
ON CONFLICT (campaign_id, connection_id) DO NOTHING;
