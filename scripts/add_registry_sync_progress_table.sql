-- Adds registry.sync_progress: persisted, resumable per-list pagination
-- cursor for ac-sync. Added after a real manual invocation against live AC
-- data hit Supabase's Edge Function idle timeout (~150s) mid-backfill — a
-- single invocation cannot page through every contact on a large list in
-- one shot, so ac-sync now works in time-budgeted chunks (see
-- lib/registryPipeline/sync.ts) and needs somewhere durable to remember
-- where it got up to between invocations.
--
-- `next_offset IS NULL` (or no row at all) means "start this list from the
-- top" — either a fresh pass, or the previous invocation fully drained it
-- (an empty page clears the row). A non-null offset means "resume here."
--
-- Run this in the Supabase SQL Editor (idempotent).

CREATE TABLE IF NOT EXISTS registry.sync_progress (
  list_id      TEXT PRIMARY KEY,
  next_offset  INTEGER NOT NULL,
  updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

COMMENT ON TABLE registry.sync_progress IS 'Resumable per-list AC pagination cursor for ac-sync, used only within one logical sync pass — cleared once a list''s page comes back empty. Not a substitute for sync_log.completed_at, which is the (unrelated) incremental "updated_since" cursor across passes.';

ALTER TABLE registry.sync_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON registry.sync_progress FROM anon, authenticated;

-- Learned the hard way on the tables in create_registry_pipeline_schema.sql
-- (see grant_registry_pipeline_service_role.sql): REVOKE-ing anon/authenticated
-- does not, by itself, give service_role anything — grant it explicitly.
GRANT USAGE ON SCHEMA registry TO service_role;
GRANT ALL ON registry.sync_progress TO service_role;
