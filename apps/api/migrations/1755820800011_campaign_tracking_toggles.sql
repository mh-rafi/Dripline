-- Per-campaign open/click tracking toggles. See CampaignDetail discussion in
-- docs/plan/DEVELOPMENT_PLAN.md: tracking is a render-time decision (pixel
-- injection / link rewriting in mailer.ts) tied to what a given campaign's
-- content should look like, not to which connection sends it.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS track_opens BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS track_clicks BOOLEAN NOT NULL DEFAULT true;
