-- Add email-capture columns to state_leaders, ahead of a later phase that
-- moves leader login off mobile+name onto real Supabase Auth (magic-link +
-- MFA) accounts, mirroring the pattern already running for the /registry
-- portal (registry.leader_roles, lib/registryPipeline/mfaGate.ts). This
-- migration is schema-only: nothing here changes login or RLS yet — see
-- lib/auth.ts's signInWithMobileAndName/completeSignIn, still the only
-- active identity check as of this migration.
--
-- email              — confirmed address; set only once the leader has
--                       proven inbox control via the magic-link flow
--                       (app/api/auth/confirm-email/route.ts), or an admin
--                       sets it directly from /admin/state-leaders (no
--                       click-verification required for that path).
-- pending_email      — a proposed address awaiting confirmation, written
--                       by app/api/auth/propose-email/route.ts. Cleared
--                       once confirmed or replaced by a newer proposal.
-- user_id            — the confirmed leader's real auth.users row, set at
--                       the same time as email. Not read by any RLS policy
--                       yet — that's a later phase. Deliberately NOT unique
--                       (a multi-state leader's several rows share one
--                       user_id once all are confirmed).
-- email_confirmed_at — when `email` was set, for audit/reporting.
--
-- Run this in the Supabase SQL Editor.

ALTER TABLE state_leaders
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS pending_email TEXT,
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMP WITH TIME ZONE;

-- Unique per state once populated — prevents two different leaders in the
-- SAME state claiming one address, while still letting the same person's
-- own rows in different states share an email (this app's existing
-- multi-state-leader support — see lib/auth.ts's StateLeaderMatch[]/
-- pendingMatches state-picker flow on the login page). Partial
-- (WHERE email IS NOT NULL), same pattern as
-- scripts/add_state_leaders_mobile_index.sql.
CREATE UNIQUE INDEX IF NOT EXISTS idx_state_leaders_email_unique_per_state
  ON state_leaders (state, email) WHERE email IS NOT NULL;

COMMENT ON COLUMN state_leaders.email IS 'Confirmed email address (magic-link verified, or admin-set). NULL until proven.';
COMMENT ON COLUMN state_leaders.pending_email IS 'Proposed address awaiting magic-link confirmation. Cleared once confirmed or re-proposed.';
COMMENT ON COLUMN state_leaders.user_id IS 'auth.users.id once email is confirmed. Not used by any RLS policy yet.';
COMMENT ON COLUMN state_leaders.email_confirmed_at IS 'When `email` was confirmed/set.';
