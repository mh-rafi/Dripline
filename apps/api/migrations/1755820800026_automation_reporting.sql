-- What the automation report needs that nothing recorded yet.
--
-- 1. A funnel needs "how many contacts reached each step". Enrollments only
--    say where a contact is *now* (and completed runs say nothing at all), so
--    the step counts had to come from an append-only log.
CREATE TABLE automation_node_runs (
    id BIGSERIAL PRIMARY KEY,
    automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    -- Text, and deliberately not a foreign key: the graph lives in a jsonb
    -- column, and a node deleted from it should leave its history readable.
    node_id TEXT NOT NULL,
    enrollment_id BIGINT NOT NULL REFERENCES automation_enrollments(id) ON DELETE CASCADE,
    subscriber_id INTEGER REFERENCES subscribers(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_automation_node_runs_step ON automation_node_runs(automation_id, node_id);
-- One row per (enrollment, node), so a `retry` result -- a send that hit a
-- rate limit comes back to the same node a minute later -- counts as one
-- contact reaching the step, not several. The runner inserts with
-- ON CONFLICT DO NOTHING against this.
CREATE UNIQUE INDEX idx_automation_node_runs_once ON automation_node_runs(enrollment_id, node_id);

-- 2. Unsubscribes were attributed to the automation, but the report shows an
--    unsubscribe rate per *email*. automation_email_nodes already interns the
--    (automation, node) pair for open/click tracking; pointing departures at
--    the same row makes the per-email rate a plain join, and the existing
--    automation_id stays populated so automation-level totals and links
--    already sitting in inboxes keep working unchanged.
ALTER TABLE campaign_unsubscribes
    ADD COLUMN automation_email_node_id INTEGER
        REFERENCES automation_email_nodes(id) ON DELETE SET NULL;
CREATE INDEX idx_campaign_unsubscribes_automation_email_node
    ON campaign_unsubscribes(automation_email_node_id);
