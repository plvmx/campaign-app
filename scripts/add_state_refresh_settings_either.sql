-- Migration: Add 'either' weekly refresh mode and set as default
-- Run this in Supabase SQL Editor after add_state_refresh_settings.sql.
-- Either = copy from past week only when no rule exists for that leader/place/time; otherwise use rule.

-- Allow new value and set default for new rows (existing saved values unchanged)
ALTER TABLE state_refresh_settings
  DROP CONSTRAINT IF EXISTS state_refresh_settings_refresh_mode_check;

ALTER TABLE state_refresh_settings
  ADD CONSTRAINT state_refresh_settings_refresh_mode_check
  CHECK (refresh_mode IN ('copy', 'rules', 'both', 'either'));

ALTER TABLE state_refresh_settings
  ALTER COLUMN refresh_mode SET DEFAULT 'either';

COMMENT ON TABLE state_refresh_settings IS 'Per-state weekly refresh mode: copy, rules, both, or either (copy only when no rule for that campaign).';
