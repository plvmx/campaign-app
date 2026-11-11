-- Campaign Report project — see docs/campaign-report/BRIEF.md.
--
-- Admin-confirmed mappings from a sheet "Location" spelling to a state (and,
-- when known, a state_places place), so lib/campaignReportMatcher.ts can
-- resolve it on every later sync. Maintained from /admin/campaign-report-locations.
--
-- location_key is the lower-cased output of normalizeLocationForMatch()
-- (lib/campaignReportMatcher.ts's locationKey()). `place` is null when only
-- the state is known; it is otherwise a state_places.place in that state
-- (enforced by the app, not an FK, since state_places' key is state+place).
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS campaign_report_location_aliases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  place TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE campaign_report_location_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_report_location_aliases: admin can read" ON campaign_report_location_aliases;
CREATE POLICY "campaign_report_location_aliases: admin can read"
  ON campaign_report_location_aliases FOR SELECT TO authenticated
  USING (public.is_admin());

-- No authenticated write policy — written by the service role only
-- (POST /api/admin/campaign-reports/locations).
