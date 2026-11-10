-- Marks where a `results` row came from, so rows written by the experimental
-- "TWOL Campaign Report" page (/record-results/report, see
-- lib/services/campaignReportSaveService.ts) can be found — and deleted —
-- without touching real Record Results data.
--
-- NULL = a normal row (every existing row, and everything the current Record
-- Results screen writes). 'app_report_experimental' = written by the
-- experimental report page. `campaign_reports.source` already exists and
-- uses the same value for that page's report rows.
--
-- To remove everything the experimental page wrote:
--   DELETE FROM results WHERE source = 'app_report_experimental';
--   DELETE FROM campaign_reports WHERE source = 'app_report_experimental';
--
-- Run this in the Supabase SQL Editor BEFORE using the experimental page's
-- Save button (it inserts this column).

ALTER TABLE results ADD COLUMN IF NOT EXISTS source TEXT;

CREATE INDEX IF NOT EXISTS idx_results_source ON results(source) WHERE source IS NOT NULL;

COMMENT ON COLUMN results.source IS 'NULL for normal rows; app_report_experimental for rows written by the experimental /record-results/report page.';
