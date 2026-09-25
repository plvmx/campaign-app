-- Add mfa_enrolled_at to state_leaders — lets a leader who has already
-- confirmed a real email (scripts/add_email_to_state_leaders.sql) set up
-- MFA (TOTP or phone/SMS) ahead of a LATER, separate phase that switches
-- login onto real Supabase Auth + MFA and starts enforcing it. This
-- migration is schema-only: nothing here changes login or RLS yet — see
-- app/setup-mfa/page.tsx and app/api/auth/complete-mfa-setup/route.ts.
--
-- mfa_enrolled_at — when this person completed MFA enrollment (TOTP or
-- phone challengeAndVerify success). NULL until enrolled. Set via
-- UPDATE ... WHERE user_id = $user.id (see complete-mfa-setup/route.ts) —
-- every state_leaders row already carrying that user_id gets the same
-- timestamp in one statement; rows this person hasn't yet confirmed
-- email on (still user_id IS NULL) are correctly left untouched.
--
-- No separate audit table for this pass, unlike email — this is a simple
-- enrollment flag, not a security-sensitive change-log field.
--
-- Run this in the Supabase SQL Editor.

ALTER TABLE state_leaders
  ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN state_leaders.mfa_enrolled_at IS 'When this person completed MFA enrollment (TOTP or phone). Set on every row sharing their user_id. NULL until enrolled. Not yet enforced by login/RLS.';
