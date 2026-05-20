-- Migration 003: Enrich weekly_refresh_log with run statistics
-- Run this in the Supabase SQL editor before deploying the automated-refresh code.

ALTER TABLE weekly_refresh_log
  ADD COLUMN IF NOT EXISTS campaigns_created integer,
  ADD COLUMN IF NOT EXISTS campaigns_deleted integer,
  ADD COLUMN IF NOT EXISTS campaigns_skipped integer,
  ADD COLUMN IF NOT EXISTS error_message    text,
  ADD COLUMN IF NOT EXISTS triggered_by     text DEFAULT 'manual';

-- Optional: back-fill existing rows so triggered_by is never null
UPDATE weekly_refresh_log SET triggered_by = 'manual' WHERE triggered_by IS NULL;
