-- Phase 7: bounce handling.

CREATE TABLE bounces (
    id BIGSERIAL PRIMARY KEY,
    subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
    campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
    type TEXT NOT NULL DEFAULT 'hard' CHECK (type IN ('hard', 'soft', 'complaint')),
    source TEXT NOT NULL DEFAULT '',
    meta JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bounces_subscriber_id ON bounces(subscriber_id);
CREATE INDEX idx_bounces_campaign_id ON bounces(campaign_id);
