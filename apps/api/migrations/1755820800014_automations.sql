-- Automations v2: replaces the flat-step "workflows" model with a node graph.
-- Hard cutover -- see docs/plan/automations_v2.md. The old tables are dropped
-- rather than migrated: the step-array shape has no node ids to carry over.

DROP TABLE IF EXISTS workflow_events;
DROP TABLE IF EXISTS workflow_enrollments;
DROP TABLE IF EXISTS workflows;

CREATE TABLE automations (
    id SERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'paused')),
    -- Registry key, validated in application code (see automations/triggers.ts)
    -- rather than a CHECK constraint: adding a trigger type should not require
    -- a migration.
    trigger_type TEXT NOT NULL,
    trigger_config JSONB NOT NULL DEFAULT '{}',
    -- { "entry": <node id|null>, "nodes": [ { id, type, title, note, config, next } ] }
    -- Pointer edges, not an ordered array, so conditional yes/no branches can be
    -- added later without a second model.
    graph JSONB NOT NULL DEFAULT '{"entry": null, "nodes": []}',
    reentry_mode TEXT NOT NULL DEFAULT 'once' CHECK (reentry_mode IN ('once', 'multiple')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Every fired event resolves its candidate automations through this pair.
CREATE INDEX idx_automations_trigger ON automations(status, trigger_type);
CREATE TRIGGER trg_automations_updated_at BEFORE UPDATE ON automations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE automation_enrollments (
    id BIGSERIAL PRIMARY KEY,
    automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    -- A node id from the automation's graph, not an index: editing the graph
    -- while contacts are mid-flight must not shift everyone's position.
    current_node_id TEXT,
    next_run_at TIMESTAMPTZ,
    context JSONB NOT NULL DEFAULT '{}',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_automation_enrollments_pending
    ON automation_enrollments(status, next_run_at);
CREATE INDEX idx_automation_enrollments_automation
    ON automation_enrollments(automation_id, status);
-- One *active* enrollment per (automation, contact); re-entry after
-- completion is a fresh row, gated by automations.reentry_mode.
CREATE UNIQUE INDEX idx_automation_enrollments_active_unique
    ON automation_enrollments(automation_id, subscriber_id) WHERE status = 'active';
CREATE TRIGGER trg_automation_enrollments_updated_at BEFORE UPDATE ON automation_enrollments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Raw ingress log for asynchronous event sources (incoming webhooks, link
-- clicks). Enrollment happens inline; these rows are the audit trail and the
-- retry surface if inline matching ever fails.
CREATE TABLE automation_events (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    event_key TEXT NOT NULL,
    subscriber_id INTEGER REFERENCES subscribers(id) ON DELETE SET NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_automation_events_key ON automation_events(event_key, created_at DESC);
