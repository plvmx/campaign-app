-- Adds an explicit `status` column to registry.sync_log, distinguishing a
-- genuine successful completion from a failure or a partial (time-budget)
-- run.
--
-- BUG THIS FIXES: getLastCompletedSyncTimestamp() (supabase/functions/ac-sync/db.ts)
-- previously used `completed_at IS NOT NULL` as its proxy for "this run is a
-- trustworthy source for the incremental filters[updated_since] cursor". But
-- failSyncLog() ALSO sets completed_at (on any thrown error, e.g. an AC
-- 502/503) — only recordPartialSync() (a time-budget stop, the normal case
-- during this backfill) leaves it null. So a run that threw partway through
-- was indistinguishable from a run that finished cleanly.
--
-- CONFIRMED VIA LIVE DATA (2026-09-01): the most recent completed_at in the
-- table belonged to sync_log id 83, a FAILED run from 2026-08-27T10:57:46
-- ("AC API error 503 calling /contacts/7379/contactTags") — meaning every
-- invocation since has been passing that failure's timestamp as
-- filters[updated_since]. No genuine full sync has completed yet during
-- this backfill, so this hasn't caused data loss so far, but it would have
-- silently corrupted the incremental cursor the moment a real backfill
-- completion happened, and remains a real risk for every future scheduled
-- sync. See docs/registry-pipeline/OPERATIONS.md for the full incident.
--
-- Run this in the Supabase SQL Editor, then deploy the corresponding
-- db.ts change.

ALTER TABLE registry.sync_log ADD COLUMN status TEXT;

-- Backfill existing rows from their current (completed_at, notes) shape,
-- so historical rows aren't silently miscategorized once the app starts
-- relying on `status` instead:
UPDATE registry.sync_log SET status = 'partial'
  WHERE completed_at IS NULL AND notes LIKE 'partial:%';

UPDATE registry.sync_log SET status = 'failed'
  WHERE completed_at IS NOT NULL AND notes IS NOT NULL AND notes NOT LIKE 'partial:%';

UPDATE registry.sync_log SET status = 'success'
  WHERE completed_at IS NOT NULL AND notes IS NULL;

-- Rows with neither completed_at nor notes never reached ANY of
-- completeSyncLog/failSyncLog/recordPartialSync — the invocation was killed
-- by the platform (WORKER_RESOURCE_LIMIT/IDLE_TIMEOUT) before any of them
-- ran. 46 such rows exist, all from 2026-08-30/31, before the 65s/65s
-- budget settled — none since. Labeled distinctly so they're never
-- mistaken for a real success.
UPDATE registry.sync_log SET status = 'crashed'
  WHERE completed_at IS NULL AND notes IS NULL;

-- Sanity check: every row should now have a status. Run after the UPDATEs
-- above — expect 0 rows back.
-- SELECT id, started_at, completed_at, notes FROM registry.sync_log WHERE status IS NULL;
