-- Unsubscribes as events, not just a state flip. subscriber_lists records
-- only current state, so before this there was no way to say which campaign
-- or automation a departure came from -- unlike opens (campaign_views) and
-- clicks (link_clicks), which have always been append-only with a campaign_id.
--
-- Named for campaigns because that is the dominant case, but it carries
-- automation unsubscribes too: automation emails sign their unsubscribe links
-- against the automation's uuid (see automations/actions.ts), and both kinds
-- land on the same preference page, so one table keeps the reporting query
-- identical for both.
CREATE TABLE campaign_unsubscribes (
    id BIGSERIAL PRIMARY KEY,
    -- Nullable + SET NULL to match campaign_views/link_clicks: deleting a
    -- contact must not silently rewrite historical unsubscribe counts.
    subscriber_id INTEGER REFERENCES subscribers(id) ON DELETE SET NULL,
    campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
    automation_id INTEGER REFERENCES automations(id) ON DELETE CASCADE,
    -- 'one_click' = the RFC 8058 List-Unsubscribe target, 'preferences' = the
    -- visible page with per-list choice, 'all' = that page's leave-everything
    -- button.
    source TEXT NOT NULL CHECK (source IN ('one_click', 'preferences', 'all')),
    -- The lists actually left in this one action. One row per action (not per
    -- list), so this is where the detail lives.
    list_ids INTEGER[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Exactly one origin at most. Both null is allowed and means the signed
    -- link's uuid no longer resolves to anything, which still counts as an
    -- unsubscribe but cannot be attributed.
    CONSTRAINT campaign_unsubscribes_one_origin CHECK (campaign_id IS NULL OR automation_id IS NULL)
);
CREATE INDEX idx_campaign_unsubscribes_campaign_id ON campaign_unsubscribes(campaign_id);
CREATE INDEX idx_campaign_unsubscribes_automation_id ON campaign_unsubscribes(automation_id);
