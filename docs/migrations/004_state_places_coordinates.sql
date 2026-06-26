-- Migration 004: Add geocoded coordinates to state_places
-- Run this in the Supabase SQL editor before deploying the campaign-map feature.
-- Coordinates are populated lazily (on first map view) by the app, not backfilled here.

ALTER TABLE state_places
  ADD COLUMN IF NOT EXISTS latitude  double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;
