-- Migration: Last sign-in tracking and weekly refresh log
-- Run this in Supabase SQL Editor after state_leaders exists.
-- 1. Add last_sign_in_at to state_leaders (record when each leader signs in)
-- 2. Create weekly_refresh_log (record when Admin runs Weekly Refresh)

-- Add last sign-in timestamp to state_leaders (nullable; UTC)
ALTER TABLE state_leaders
ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ;

-- Optional: index for "leaders not signed in since date" queries
CREATE INDEX IF NOT EXISTS idx_state_leaders_last_sign_in_at
ON state_leaders (last_sign_in_at)
WHERE last_sign_in_at IS NOT NULL;

-- Table to record each Weekly Refresh run (so we know the cutoff for "signed in since refresh")
CREATE TABLE IF NOT EXISTS weekly_refresh_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT
);

-- Index for fetching the most recent refresh
CREATE INDEX IF NOT EXISTS idx_weekly_refresh_log_completed_at
ON weekly_refresh_log (completed_at DESC);

COMMENT ON COLUMN state_leaders.last_sign_in_at IS 'When this leader last signed in to the app (UTC).';
COMMENT ON TABLE weekly_refresh_log IS 'Log of each Weekly Refresh run; used to find leaders who have not signed in since the last refresh.';
