-- Campaign Report project — see docs/campaign-report/BRIEF.md.
--
-- One row per leader's "Campaign Report" submission (aggregate tallies for
-- one campaign, not a per-person record like `results`). Historically these
-- went into a Google Sheet Jordan maintained; this table is the initial load
-- of that sheet (lib/campaignReportParser.ts + scripts/import_campaign_reports.ts),
-- plus every submission through the in-app replacement screen once that
-- ships (phase 3).
--
-- Location and leader are free text as originally typed — nowhere near clean
-- enough to reliably join against state_places/state_leaders (1,355 and
-- 1,693 distinct raw strings respectively in the initial load). No FK to
-- either table for now; `campaign_id` is a nullable, unenforced best-effort
-- link for a future cleanup pass, not populated by the initial import.
--
-- Every tally/date column has a paired `*_raw` column: a leader sometimes
-- typed a note instead of a number/date ("Nil", "10(1 with 5 persons...)",
-- "Gave out 3 new testaments..."), so the parsed value is nullable and the
-- original text is always kept — see lib/campaignReportParser.ts for the
-- parsing rules. `needs_review` is set whenever a date or tally couldn't be
-- confidently parsed, so a human can find those rows without scanning all of
-- them.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS campaign_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- The sheet's own "Date" column (Google Form submission timestamp). Unique
  -- and present on every historical row — the natural de-dup key used by
  -- both the initial load and the later incremental catch-up import.
  submitted_at TIMESTAMP WITH TIME ZONE NOT NULL UNIQUE,

  campaign_date DATE,
  campaign_date_raw TEXT,

  location_raw TEXT,
  leader_raw TEXT,

  partial_presentations INTEGER,
  partial_presentations_raw TEXT,
  full_presentations INTEGER,
  full_presentations_raw TEXT,
  sinners_prayer INTEGER,
  sinners_prayer_raw TEXT,
  information_requests INTEGER,
  information_requests_raw TEXT,

  needs_review BOOLEAN NOT NULL DEFAULT false,

  -- 'jordan_sheet_import' for the initial/catch-up loads; the replacement
  -- screen (phase 3) will use a different value once it exists.
  source TEXT NOT NULL DEFAULT 'jordan_sheet_import',

  -- Unenforced, nullable, not populated by the import — see header comment.
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_reports_campaign_date ON campaign_reports(campaign_date);
CREATE INDEX IF NOT EXISTS idx_campaign_reports_needs_review ON campaign_reports(needs_review) WHERE needs_review;
CREATE INDEX IF NOT EXISTS idx_campaign_reports_campaign_id ON campaign_reports(campaign_id) WHERE campaign_id IS NOT NULL;

COMMENT ON TABLE campaign_reports IS 'Aggregate per-campaign tallies from the Campaign Report form — see docs/campaign-report/BRIEF.md.';
COMMENT ON COLUMN campaign_reports.submitted_at IS 'Google Form submission timestamp from the source sheet; unique de-dup key for re-imports.';
COMMENT ON COLUMN campaign_reports.needs_review IS 'Set when campaign_date or any tally column held text the parser could not confidently turn into a value — see lib/campaignReportParser.ts.';
COMMENT ON COLUMN campaign_reports.campaign_id IS 'Best-effort link to campaigns.id for a future cleanup pass. Not populated by the initial import — location/leader are free text, not reliably matchable.';

-- Row-Level Security: see supabase/rls-policies.sql. Admin-only for now
-- (matching campaign_changes_log) — a leader-scoped policy comes with the
-- phase 3 replacement screen, once submissions are tied to a real leader
-- identity rather than free text.
ALTER TABLE campaign_reports ENABLE ROW LEVEL SECURITY;
