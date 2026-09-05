-- Enriches registry.registrants with three fields Peter asked for after
-- looking at the live data (2026-09-01):
--   1. Separate first_name/last_name, instead of one combined full_name.
--   2. registered_at — AC's own contact.cdate (when they actually
--      registered), distinct from first_seen_at (when THIS PIPELINE
--      happened to sync them — misleading for anyone backfilled long
--      after they originally registered).
--   3. interested_in_training — AC field [9], already confirmed
--      live/populated and already in fieldMap.ts's whitelist (plan
--      Section 3.4), just not previously promoted to a column.
--
-- "Church Leader?" (AC field [10]/[28]) was explicitly asked about and
-- deliberately NOT included here — still excluded per the original
-- brief's leadership decision (see fieldMap.ts's ALLOWED_CUSTOM_FIELD_IDS
-- comment); re-including it needs its own explicit sign-off, same
-- treatment as postcode originally needed.
--
-- Run this in the Supabase SQL Editor.

ALTER TABLE registry.registrants ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE registry.registrants ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Best-effort backfill of already-synced rows from the existing full_name,
-- splitting on the first space. A single-word name lands entirely in
-- first_name (last_name stays null) rather than being duplicated into both.
UPDATE registry.registrants
SET
  first_name = COALESCE(first_name, split_part(full_name, ' ', 1)),
  last_name = COALESCE(last_name, NULLIF(trim(regexp_replace(full_name, '^\S+\s*', '')), ''))
WHERE full_name IS NOT NULL;

ALTER TABLE registry.registrants DROP COLUMN IF EXISTS full_name;

ALTER TABLE registry.registrants ADD COLUMN IF NOT EXISTS registered_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE registry.registrants ADD COLUMN IF NOT EXISTS interested_in_training TEXT;

COMMENT ON COLUMN registry.registrants.registered_at IS 'AC contact.cdate — when they actually registered. NOT the same as first_seen_at, which is when this pipeline happened to sync them (can be long after, for backfilled historical registrants).';
COMMENT ON COLUMN registry.registrants.interested_in_training IS 'AC field [9] "Interested in training?" — raw value (e.g. "Yes"/"No"), stored as-is like state/postcode elsewhere in this table.';
