-- Campaign Report project — see docs/campaign-report/BRIEF.md.
--
-- Adds derived_state/derived_place/derived_leader to campaign_reports,
-- populated (for rows submitted on/after 2026-05-06 only — see the BRIEF's
-- "resumed with narrowed scope" note) by matching the sheet's free-text
-- location_raw/leader_raw against this app's own state_places/state_leaders
-- via lib/campaignReportMatcher.ts + scripts/derive_campaign_reports_fields.ts.
--
-- Nullable, never guessed: a row that can't be confidently resolved keeps
-- all three null, same "keep + flag, don't guess" philosophy as
-- campaign_date/needs_review from phase 1. No FK to state_places/state_leaders
-- (both are free-text-derived, not a live join — a place or leader could be
-- renamed/removed later without this table knowing).
--
-- Run this in the Supabase SQL Editor.

ALTER TABLE campaign_reports
  ADD COLUMN IF NOT EXISTS derived_state TEXT,
  ADD COLUMN IF NOT EXISTS derived_place TEXT,
  ADD COLUMN IF NOT EXISTS derived_leader TEXT;

CREATE INDEX IF NOT EXISTS idx_campaign_reports_derived_state
  ON campaign_reports(derived_state) WHERE derived_state IS NOT NULL;

COMMENT ON COLUMN campaign_reports.derived_state IS
  'State derived from location_raw/leader_raw via lib/campaignReportMatcher.ts, for rows submitted on/after 2026-05-06. Null = not confidently resolvable (never guessed).';
COMMENT ON COLUMN campaign_reports.derived_place IS
  'Place derived from location_raw via lib/campaignReportMatcher.ts (matched against state_places). Null when the state resolved but the specific place/site did not (e.g. an ambiguous site number), or when nothing resolved.';
COMMENT ON COLUMN campaign_reports.derived_leader IS
  'Leader derived from leader_raw via lib/campaignReportMatcher.ts (matched against state_leaders). Null when not confidently resolvable.';
