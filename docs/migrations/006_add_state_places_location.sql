-- Migration 006: Add `location` column to state_places.
--
-- `location` is the free-text actual geographic location (suburb, town, etc.) for a
-- state_places row. It becomes the sole source used to derive latitude/longitude —
-- the admin Campaign Map and Campaigns Near Me features now geocode against
-- `location` instead of the (often venue/event-named) `place` field.
--
-- Nullable: existing rows are backfilled by `node scripts/backfill_state_places_location.js`
-- (dry-run, then --apply) after this migration lands; the admin form requires it for
-- new/edited rows going forward.
--
-- Run this in the Supabase SQL editor before deploying the location-field feature.

ALTER TABLE state_places ADD COLUMN IF NOT EXISTS location TEXT;

COMMENT ON COLUMN state_places.location IS
  'Actual geographic location (suburb/town) for this place — sole source for deriving latitude/longitude.';
