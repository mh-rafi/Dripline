-- Phase 3: sending providers (built before campaigns since campaign_emails references it).

CREATE TABLE providers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'smtp' CHECK (type IN ('smtp')),
    config JSONB NOT NULL DEFAULT '{}',
    from_email TEXT NOT NULL,
    weight INTEGER NOT NULL DEFAULT 1 CHECK (weight > 0),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    max_errors INTEGER NOT NULL DEFAULT 20,
    error_count INTEGER NOT NULL DEFAULT 0,
    disabled_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_providers_updated_at BEFORE UPDATE ON providers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
