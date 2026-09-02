-- Per-node open/click tracking for automation emails.
--
-- The existing tables can't carry this: campaign_views.campaign_id is NOT NULL
-- REFERENCES campaigns(id), and link_clicks is decoded from a campaign-encoded
-- URL. Attribution also has to be per *node*, not per automation -- "clicks on
-- this automation" across a five-email drip is not a number anyone can act on.
--
-- automation_email_nodes interns the (automation, node) pair the way `links`
-- interns a URL, and everything else points at that one small integer. That is
-- what keeps a tracking URL short: node ids are arbitrary strings (the builder
-- makes `n_ab12cd34`, but the graph schema allows any non-empty string), and
-- putting one in the path would blow the ~120-character budget SpamAssassin
-- starts penalizing. See docs/plan/deliverability.md.
CREATE TABLE automation_email_nodes (
    id SERIAL PRIMARY KEY,
    automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    -- The graph node id. Text, and deliberately not a foreign key: the graph
    -- lives in a jsonb column, and a node deleted from it should leave its
    -- history readable rather than cascading away.
    node_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (automation_id, node_id)
);

-- One row per email actually handed to a connection. Exists to be the
-- denominator: without it an open count has nothing to be a rate of. The
-- general per-node run log (every node type, for the canvas stats overlay) is
-- still Phase 2 -- this is only the email steps.
CREATE TABLE automation_email_sends (
    id BIGSERIAL PRIMARY KEY,
    email_node_id INTEGER NOT NULL REFERENCES automation_email_nodes(id) ON DELETE CASCADE,
    -- Nullable + SET NULL to match campaign_views/link_clicks: deleting a
    -- contact must not silently rewrite historical counts.
    subscriber_id INTEGER REFERENCES subscribers(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_automation_email_sends_node ON automation_email_sends(email_node_id);

CREATE TABLE automation_views (
    id BIGSERIAL PRIMARY KEY,
    email_node_id INTEGER NOT NULL REFERENCES automation_email_nodes(id) ON DELETE CASCADE,
    subscriber_id INTEGER REFERENCES subscribers(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_automation_views_node ON automation_views(email_node_id);

-- Reuses the shared `links` table (url interning was never campaign-scoped),
-- so a URL appearing in both a campaign and an automation is one row there.
CREATE TABLE automation_link_clicks (
    id BIGSERIAL PRIMARY KEY,
    email_node_id INTEGER NOT NULL REFERENCES automation_email_nodes(id) ON DELETE CASCADE,
    link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    subscriber_id INTEGER REFERENCES subscribers(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_automation_link_clicks_node ON automation_link_clicks(email_node_id);
CREATE INDEX idx_automation_link_clicks_link_id ON automation_link_clicks(link_id);
