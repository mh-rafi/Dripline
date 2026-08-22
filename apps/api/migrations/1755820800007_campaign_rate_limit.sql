-- Generalizes campaign throttling from a fixed "count per minute" field into
-- the same count/duration/window fixed-window rate-limit shape connections
-- use, so a campaign can express e.g. "1 email per 5 minutes" -- not just a
-- per-minute count, which was tied to the dispatch scan's 1-minute cadence
-- and couldn't express anything slower than that.
--
-- This is a secondary, optional cap on top of the connection's own (primary,
-- authoritative) rate limit -- see services/rateLimiter.ts.

ALTER TABLE campaigns RENAME COLUMN messages_per_minute TO rate_limit_count;
ALTER TABLE campaigns ALTER COLUMN rate_limit_count DROP NOT NULL;
ALTER TABLE campaigns ALTER COLUMN rate_limit_count DROP DEFAULT;

ALTER TABLE campaigns ADD COLUMN rate_limit_duration_seconds INTEGER;
-- Existing campaigns already had an implicit "per minute" throttle; preserve
-- that behavior exactly rather than silently making them unlimited.
UPDATE campaigns SET rate_limit_duration_seconds = 60 WHERE rate_limit_count IS NOT NULL;

-- Fixed-window rate-limit state, same shape as connections.window_start/window_count.
ALTER TABLE campaigns ADD COLUMN window_start TIMESTAMPTZ;
ALTER TABLE campaigns ADD COLUMN window_count INTEGER NOT NULL DEFAULT 0;
