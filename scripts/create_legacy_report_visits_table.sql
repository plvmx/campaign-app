-- One row per visit to /public/campaign-reporting-moved — the page leaders land
-- on when they use the OLD campaign results report
-- (australiaforjesus.org.au/campaignreport/), so an admin can see how many are
-- still trying to report that way (card on /admin, GET /api/admin/legacy-report-visits).
--
-- device_id is a random id the page keeps in the visitor's browser (never a name
-- or number), so "how many different devices" can be told apart from repeat visits.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS legacy_report_visits (
  -- IDENTITY, not BIGSERIAL: see campaign_interest_sms_log for why.
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id   TEXT,
  visited_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

COMMENT ON TABLE legacy_report_visits IS 'Visits to the "campaign reporting has moved" page (old Google-form report redirect). Written by the service role only.';

CREATE INDEX IF NOT EXISTS idx_legacy_report_visits_visited_at ON legacy_report_visits(visited_at DESC);

ALTER TABLE legacy_report_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "legacy_report_visits: admin can read" ON legacy_report_visits;
CREATE POLICY "legacy_report_visits: admin can read"
  ON legacy_report_visits FOR SELECT TO authenticated
  USING (public.is_admin());
