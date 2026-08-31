-- Optional "why did you leave" feedback, collected on the preference page
-- *after* the unsubscribe has already been recorded -- never as a gate in
-- front of it. Both columns stay null for one-click (RFC 8058) departures,
-- which are a machine POST with no one to ask, and for anyone who skips.
--
-- No CHECK constraint on `reason` on purpose: the option list is a code-side
-- registry (lib/unsubscribeReasons.ts) so adding one stays a one-line change
-- rather than a schema migration, and Zod validates writes against it. Rows
-- naming a reason that was later removed from the registry still read back
-- fine, which is what history should do.
ALTER TABLE campaign_unsubscribes ADD COLUMN IF NOT EXISTS reason TEXT;
-- Free text from an unauthenticated public page. Length-capped in Zod, stored
-- verbatim, and only ever rendered as text.
ALTER TABLE campaign_unsubscribes ADD COLUMN IF NOT EXISTS reason_comment TEXT;
