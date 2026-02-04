-- Migration: Per-state weekly refresh mode
-- Run this in Supabase SQL Editor.
-- Allows state reporters to set how weekly refresh runs for their state: copy, rules, or both.

CREATE TABLE IF NOT EXISTS state_refresh_settings (
  state TEXT NOT NULL PRIMARY KEY,
  refresh_mode TEXT NOT NULL CHECK (refresh_mode IN ('copy', 'rules', 'both')) DEFAULT 'copy',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

COMMENT ON TABLE state_refresh_settings IS 'Per-state weekly refresh mode; state reporters can set copy, rules, or both for their state.';
