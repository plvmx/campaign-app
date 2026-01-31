-- Delete campaign_changes_log records older than a specified date
-- Run this in the Supabase SQL Editor.
--
-- 1. Change the date below to your cutoff (YYYY-MM-DD). Records with created_at
--    BEFORE this date will be deleted.
-- 2. Optionally run the SELECT first to see how many rows will be affected.
-- 3. Run the DELETE.

-- ========== CUTOFF DATE: change this to your desired date (YYYY-MM-DD) ==========
-- Example: '2024-01-01' deletes all log records from before 1 Jan 2024

-- Preview: how many rows will be deleted (optional - run this first)
/*
SELECT COUNT(*) AS rows_to_delete
FROM campaign_changes_log
WHERE created_at < '2024-01-01';
*/

-- Delete log records older than the cutoff date
DELETE FROM campaign_changes_log
WHERE created_at < '2024-01-01';
