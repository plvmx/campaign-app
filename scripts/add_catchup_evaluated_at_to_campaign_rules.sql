-- Migration: track the weekly-refresh catch-up pass explicitly on campaign_rules,
-- instead of inferring it by matching existing campaign rows.
-- Run this in Supabase SQL Editor.
--
-- Background: the old inference approach matched on state+place+site+time+leader, which
-- breaks the moment a rule's `time` is edited after its first occurrence was generated
-- (the already-generated campaign correctly keeps its original time, but no longer looks
-- like it belongs to the rule) — see PR #91. This column makes catch-up a true one-off
-- per rule: NULL means "not yet evaluated by a catch-up pass", set once and never reset.

ALTER TABLE campaign_rules ADD COLUMN IF NOT EXISTS catchup_evaluated_at TIMESTAMPTZ;

COMMENT ON COLUMN campaign_rules.catchup_evaluated_at IS
  'Set the first time the weekly refresh''s catch-up pass evaluates this rule. NULL means the rule is still eligible for its one-off catch-up evaluation.';

-- Backfill: every rule that exists before this migration already has its normal weekly
-- schedule running and does not need a retroactive catch-up backfill. Mark them all as
-- already evaluated so catch-up only ever fires for rules created after this point.
UPDATE campaign_rules SET catchup_evaluated_at = NOW() WHERE catchup_evaluated_at IS NULL;
