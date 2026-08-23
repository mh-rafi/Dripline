-- Per-connection List-Unsubscribe / List-Unsubscribe-Post headers. See
-- docs/plan/DEVELOPMENT_PLAN.md Phase 8 addendum for why this lives on
-- connections rather than a global setting or per-campaign field.
ALTER TABLE connections ADD COLUMN IF NOT EXISTS list_unsubscribe_header BOOLEAN NOT NULL DEFAULT true;
