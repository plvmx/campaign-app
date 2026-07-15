-- Migration 005: Add `site` column to state_places, campaigns, and campaign_rules.
--
-- `site` models the numeric sub-location suffix that was previously baked into the
-- free-text `place` string (e.g. "Orange 1", "Frankston 2"). It becomes part of the
-- state_places uniqueness key: UNIQUE(state, place, site).
--
-- `site` is NOT NULL DEFAULT '' (not nullable) — Postgres treats every NULL as
-- distinct in a unique constraint, which would silently defeat "part of the key"
-- for the common no-site case.
--
-- Run this in the Supabase SQL editor. After it lands, run
-- `node scripts/migrate_place_site_split.js` (dry-run, then --apply) to split any
-- existing baked-in suffixes out of `place` into the new `site` column.

ALTER TABLE state_places   ADD COLUMN IF NOT EXISTS site TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns      ADD COLUMN IF NOT EXISTS site TEXT NOT NULL DEFAULT '';
ALTER TABLE campaign_rules ADD COLUMN IF NOT EXISTS site TEXT NOT NULL DEFAULT '';

-- Replace the old UNIQUE(state, place) constraint with UNIQUE(state, place, site).
-- Looks the old constraint up by its columns rather than assuming Postgres's default
-- name, in case it was ever created or renamed differently.
DO $$
DECLARE
  old_constraint_name text;
BEGIN
  SELECT con.conname INTO old_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'state_places'
    AND con.contype = 'u'
    AND (
      SELECT array_agg(attname ORDER BY attname)
      FROM unnest(con.conkey) AS k(attnum)
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
    ) = ARRAY['place', 'state']::name[]
  LIMIT 1;

  IF old_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE state_places DROP CONSTRAINT %I', old_constraint_name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'state_places_state_place_site_key'
  ) THEN
    ALTER TABLE state_places ADD CONSTRAINT state_places_state_place_site_key UNIQUE (state, place, site);
  END IF;
END $$;
