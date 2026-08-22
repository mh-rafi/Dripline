-- Phase 4 + 5: automations (drip sequences + event-based triggers).

CREATE TABLE workflows (
    id SERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    name TEXT NOT NULL,
    trigger_type TEXT NOT NULL
        CHECK (trigger_type IN ('list_joined', 'tag_applied', 'webhook', 'link_clicked', 'manual')),
    trigger_config JSONB NOT NULL DEFAULT '{}',
    -- Ordered list of step objects: [{ "type": "delay" | "send_email" | "add_tag" |
    -- "remove_tag" | "add_list" | "remove_list" | "condition" | "webhook_out", ...cfg }]
    steps JSONB NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused')),
    reentry_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_workflows_updated_at BEFORE UPDATE ON workflows
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE workflow_enrollments (
    id BIGSERIAL PRIMARY KEY,
    workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    current_step INTEGER NOT NULL DEFAULT 0,
    next_run_at TIMESTAMPTZ,
    context JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_workflow_enrollments_pending ON workflow_enrollments(workflow_id, status, next_run_at);
-- Only one *active* enrollment per (workflow, subscriber) at a time; re-enrollment
-- after completion/cancellation is a fresh row, gated by workflows.reentry_allowed.
CREATE UNIQUE INDEX idx_workflow_enrollments_active_unique
    ON workflow_enrollments(workflow_id, subscriber_id) WHERE status = 'active';
CREATE TRIGGER trg_workflow_enrollments_updated_at BEFORE UPDATE ON workflow_enrollments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE workflow_events (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    event_key TEXT NOT NULL,
    subscriber_id INTEGER REFERENCES subscribers(id) ON DELETE SET NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_workflow_events_unprocessed ON workflow_events(processed, created_at);
CREATE INDEX idx_workflow_events_key ON workflow_events(event_key);
