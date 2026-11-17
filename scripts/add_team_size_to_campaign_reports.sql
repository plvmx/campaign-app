-- Team size (including the leader) entered on the TWOL Campaign Report page
-- (/record-results/report). 1-99; NULL for every older row (sheet imports and
-- reports saved before the field existed). The report email shows it after
-- the leader's name as (+N) when it is more than 1.
--
-- Run this in the Supabase SQL Editor BEFORE the code that writes it is
-- deployed (the page's Save inserts this column).

ALTER TABLE campaign_reports ADD COLUMN IF NOT EXISTS team_size INTEGER;

ALTER TABLE campaign_reports DROP CONSTRAINT IF EXISTS campaign_reports_team_size_range;
ALTER TABLE campaign_reports ADD CONSTRAINT campaign_reports_team_size_range
  CHECK (team_size IS NULL OR (team_size >= 1 AND team_size <= 99));

COMMENT ON COLUMN campaign_reports.team_size IS 'People on the campaign team including the leader (1-99); NULL for rows saved before the field existed.';
