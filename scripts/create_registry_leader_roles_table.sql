-- AFJ Registry Pipeline — leader role/scope table backing the Supabase Auth
-- (magic-link) rollout for leaders. See docs/registry-pipeline/
-- AFJ_PII_Technical_Implementation_Plan.md Section 7.1.
--
-- Scope note (deliberate, see docs/registry-pipeline/BRIEF.md "Explicitly
-- out of scope"): this script creates the role table and the MFA
-- bookkeeping/enforcement helper below. It does NOT create the
-- RLS-scoped `registry.v_leader_registrants` view from plan Section 7.2 —
-- that's blocked until this auth rollout is live and tested end-to-end.
--
-- Run this in the Supabase SQL Editor, after enabling the "Email OTP"
-- (magic link) provider for this project in Supabase Dashboard ->
-- Authentication -> Providers (a dashboard setting, not something this
-- script can do). See docs/registry-pipeline/OPERATIONS.md for the full
-- rollout checklist.

CREATE TABLE IF NOT EXISTS registry.leader_roles (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('state_leader', 'national_admin', 'whatsapp_admin')),
  state         TEXT,          -- NULL for national_admin / whatsapp_admin; required for state_leader (see check below)
  mfa_required  BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT state_leader_has_state CHECK (role <> 'state_leader' OR state IS NOT NULL)
);

COMMENT ON TABLE registry.leader_roles IS 'Maps auth.uid() to a registry role + state scope. national_admin and whatsapp_admin are high-privilege (see mfa_required) and see all states; state_leader is scoped to their own state via registry.v_leader_registrants once that view ships (plan Section 7.2, blocked for now).';
COMMENT ON COLUMN registry.leader_roles.mfa_required IS 'Set true for national_admin/whatsapp_admin by the trigger below. Bookkeeping only — the actual factor-verification gate is registry.has_required_mfa(), enforced by any future policy/RPC that reads registry.* on behalf of a leader (e.g. the export RPC in plan Section 7.3). Supabase Auth''s own MFA enrollment/challenge flow is separate and configured in Dashboard -> Authentication -> Multi-Factor Authentication.';

-- Keep mfa_required in lockstep with role, so it can't drift out of sync
-- (e.g. someone inserting a national_admin row with mfa_required left false).
CREATE OR REPLACE FUNCTION registry.set_leader_role_mfa_requirement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.mfa_required := NEW.role IN ('national_admin', 'whatsapp_admin');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leader_roles_mfa_requirement ON registry.leader_roles;
CREATE TRIGGER trg_leader_roles_mfa_requirement
  BEFORE INSERT OR UPDATE ON registry.leader_roles
  FOR EACH ROW
  EXECUTE FUNCTION registry.set_leader_role_mfa_requirement();

-- MFA enforcement helper: true only when the current session both (a) maps
-- to a role that doesn't require MFA, or (b) has actually completed a second
-- factor this session (aal2), not merely enrolled one. `auth.jwt()->>'aal'`
-- is the Authenticator Assurance Level Supabase Auth stamps onto the access
-- token JWT: 'aal1' = password/magic-link only, 'aal2' = MFA challenge also
-- completed. Any future policy or RPC that lets a leader read registry.*
-- data (the export RPC in plan Section 7.3, or the RLS view in 7.2 once it
-- ships) must gate on this function, not just on leader_roles existing.
CREATE OR REPLACE FUNCTION registry.has_required_mfa()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = registry, public
AS $$
  SELECT NOT COALESCE(
    (SELECT mfa_required FROM registry.leader_roles WHERE user_id = auth.uid()),
    false
  ) OR COALESCE(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

COMMENT ON FUNCTION registry.has_required_mfa() IS 'Gate for any future registry.* access path used by leaders: true if this role does not require MFA, or the current session has completed an MFA challenge (aal2). See plan Section 7.1.';

ALTER TABLE registry.leader_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON registry.leader_roles FROM anon;
-- Unlike the pipeline tables above, authenticated leaders DO need to read
-- their own row (the app needs to know a signed-in user's role/state to
-- decide what to show) — but only their own, and never write it themselves.
GRANT SELECT ON registry.leader_roles TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON registry.leader_roles FROM authenticated;

DROP POLICY IF EXISTS leader_roles_select_own ON registry.leader_roles;
CREATE POLICY leader_roles_select_own ON registry.leader_roles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Writes (granting/changing a leader's role) go through the service role
-- only — an admin action, not a self-service one — so no INSERT/UPDATE/
-- DELETE policy is defined for `authenticated` at all (default-deny).
