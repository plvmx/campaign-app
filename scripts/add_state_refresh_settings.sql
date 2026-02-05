-- Migration: Per-state weekly refresh mode
-- Run this in Supabase SQL Editor.
-- Allows state reporters to set how weekly refresh runs for their state.

CREATE TABLE IF NOT EXISTS state_refresh_settings (
  state TEXT NOT NULL PRIMARY KEY,
  refresh_mode TEXT NOT NULL CHECK (refresh_mode IN ('copy', 'rules', 'both', 'either')) DEFAULT 'either',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

COMMENT ON TABLE state_refresh_settings IS 'Per-state weekly refresh mode: copy, rules, both, or either (copy only when no rule for that campaign).';
