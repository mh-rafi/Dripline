-- Phase 0 smoke-test migration. Real schema (subscribers, lists, campaigns,
-- campaign_emails, workflows, ...) lands in Phase 1+ per docs/plan/DEVELOPMENT_PLAN.md.

CREATE TABLE IF NOT EXISTS schema_bootstrap_check (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
