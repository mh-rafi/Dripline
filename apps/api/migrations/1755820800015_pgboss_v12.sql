-- pg-boss 10 -> 12 upgrade.
--
-- pg-boss 12 refuses to migrate a schema older than its version 25, and v10
-- creates version 24 -- the library's own path would be to install pg-boss 11
-- first and boot once just to step the schema up. That's a bad ask for a
-- self-hosted install, and unnecessary here: nothing durable lives in pg-boss.
-- Every job this app queues is re-derived by the next cron tick --
-- `campaign.scan` re-enqueues a dispatch batch for every running campaign,
-- `automation.scan` for every due enrollment, `bounce.scan` is itself cron. So
-- the schema is dropped and pg-boss 12 recreates it on the next boot.
--
-- Run this with the API stopped: dropping the schema out from under a live
-- pg-boss connection will error that process.
DROP SCHEMA IF EXISTS pgboss CASCADE;

-- Dispatch rows are claimed ('pending' -> 'queued') by the scan *before* the
-- batch job that sends them. Any row sitting in 'queued' has no job behind it
-- any more, and claimBatch only ever picks up 'pending' -- so hand them back,
-- otherwise those contacts would silently never receive the campaign.
UPDATE campaign_emails
SET status = 'pending'
WHERE status = 'queued';
