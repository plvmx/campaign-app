-- Campaign Report project — see docs/campaign-report/BRIEF.md.
--
-- A Campaign Report's "Location (as typed)" is now mapped to a State Places
-- *location* (state_places.location — the real physical location, e.g.
-- "Perth CBD") instead of a State Places *place* (state_places.place — a
-- campaign-form site label such as "Perth CBD 3", where several places share
-- one location).
--
-- Additive and safe to run before the matching code is deployed:
--   * campaign_reports.derived_location        new column, filled from the old derived_place
--   * campaign_report_location_aliases.location new column, filled from the old place
-- The old derived_place / place columns are left in place, unused, and can be
-- dropped in a later cleanup once the new screens have been checked.
--
-- Reports whose derived_place no longer matches a state_places row (a place
-- that has since been renamed or removed) are left with derived_location NULL
-- and show up as "no location" for re-mapping.
--
-- Run this in the Supabase SQL Editor.

ALTER TABLE campaign_reports
  ADD COLUMN IF NOT EXISTS derived_location TEXT;

UPDATE campaign_reports r
SET derived_location = btrim(sp.location)
FROM state_places sp
WHERE r.derived_location IS NULL
  AND r.derived_place IS NOT NULL
  AND sp.state = r.derived_state
  AND sp.place = r.derived_place
  AND sp.location IS NOT NULL
  AND btrim(sp.location) <> '';

COMMENT ON COLUMN campaign_reports.derived_location IS
  'State Places location (state_places.location, the physical location) this report maps to. Replaces derived_place. Null = not mapped yet.';

ALTER TABLE campaign_report_location_aliases
  ADD COLUMN IF NOT EXISTS location TEXT;

UPDATE campaign_report_location_aliases a
SET location = btrim(sp.location)
FROM state_places sp
WHERE a.location IS NULL
  AND a.place IS NOT NULL
  AND sp.state = a.state
  AND sp.place = a.place
  AND sp.location IS NOT NULL
  AND btrim(sp.location) <> '';

COMMENT ON COLUMN campaign_report_location_aliases.location IS
  'State Places location this typed spelling maps to (replaces place). Null = state only.';
