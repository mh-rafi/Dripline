-- Phase 2: campaigns + the row-per-recipient dispatch table.
-- See docs/prd/PRD.md §8.1 for why this replaces listmonk's checkpoint approach.

CREATE TABLE campaigns (
    id SERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    from_email TEXT,
    template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL,
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'finished', 'cancelled')),
    send_at TIMESTAMPTZ,
    messages_per_minute INTEGER NOT NULL DEFAULT 60 CHECK (messages_per_minute > 0),
    max_send_errors INTEGER NOT NULL DEFAULT 100,
    to_send INTEGER NOT NULL DEFAULT 0,
    sent INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_campaigns_updated_at BEFORE UPDATE ON campaigns
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE campaign_lists (
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    PRIMARY KEY (campaign_id, list_id)
);

-- One row per (campaign, subscriber). Status only ever advances after the
-- provider confirms accept/reject -- never optimistically at fetch time.
CREATE TABLE campaign_emails (
    id BIGSERIAL PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'queued', 'sent', 'failed', 'skipped')),
    provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id, subscriber_id)
);
CREATE INDEX idx_campaign_emails_dispatch ON campaign_emails(campaign_id, status);
CREATE TRIGGER trg_campaign_emails_updated_at BEFORE UPDATE ON campaign_emails
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE campaign_views (
    id BIGSERIAL PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    subscriber_id INTEGER REFERENCES subscribers(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_campaign_views_campaign_id ON campaign_views(campaign_id);

CREATE TABLE links (
    id SERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    url TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE link_clicks (
    id BIGSERIAL PRIMARY KEY,
    link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
    subscriber_id INTEGER REFERENCES subscribers(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_link_clicks_campaign_id ON link_clicks(campaign_id);
CREATE INDEX idx_link_clicks_link_id ON link_clicks(link_id);
