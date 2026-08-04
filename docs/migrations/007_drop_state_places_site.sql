-- Migration 007: Drop the now-redundant `site` column from state_places.
--
-- `site` distinguished multiple locations sharing the same place name (e.g. "Orange 1",
-- "Orange 2"). That distinction now lives directly in `place` — the 14 state_places rows
-- that had a non-empty site were merged (e.g. place="Orange", site="1" -> place="Orange 1")
-- before this migration was written; run it only after that data migration has landed.
--
-- The corresponding `campaigns.site` and `campaign_rules.site` columns are NOT touched by
-- this migration — they stay in place, but their values were folded into `place` the same
-- way, so they're expected to be empty for all live rows going forward.
--
-- Run this in the Supabase SQL editor.

-- Replace UNIQUE(state, place, site) with UNIQUE(state, place), looked up by columns
-- rather than assuming Postgres's default constraint name (mirrors migration 005's approach).
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
    ) = ARRAY['place', 'site', 'state']::name[]
  LIMIT 1;

  IF old_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE state_places DROP CONSTRAINT %I', old_constraint_name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'state_places_state_place_key'
  ) THEN
    ALTER TABLE state_places ADD CONSTRAINT state_places_state_place_key UNIQUE (state, place);
  END IF;
END $$;

ALTER TABLE state_places DROP COLUMN IF EXISTS site;
