-- Closes the self-granted-admin hole found 2026-10-11.
--
-- THE HOLE: public.is_admin() (supabase/rls-policies.sql) decides "admin" from
-- the caller's user_profiles row (name + state matched against an 'AD' row in
-- state_leaders) — and user_profiles allowed any signed-in session, including
-- a bare anonymous one, to write its own name/state. So anyone could set their
-- profile to a real admin's name+state and read/write everything an admin can.
-- (user_roles was also wide open, but nothing actually reads it — it is
-- vestigial — so it is tightened here only for hygiene.)
--
-- THE FIX: the browser no longer writes either table. app/api/auth/
-- grant-session-access verifies the caller server-side (mobile+name, or
-- email+MFA at aal2) and writes with the service role, which bypasses these
-- grants/policies.
--
-- RUN THIS ONLY AFTER the grant-session-access route is deployed to
-- production AND browsers have had time to pick up the new app code (a
-- cached old copy of the app would still try to write directly, and its
-- sign-in would then leave a session with no profile). Allow at least a day.
--
-- Existing signed-in sessions keep working (their profile rows already exist).

BEGIN;

-- 1. user_profiles: read-only for the browser (name/state are identity).
REVOKE INSERT, UPDATE ON public.user_profiles FROM authenticated, anon;

-- 2. user_roles: vestigial, so remove the open policies. Keeps "users read own row".
DROP POLICY IF EXISTS "Authenticated users can view user_roles"   ON public.user_roles;
DROP POLICY IF EXISTS "Authenticated users can insert user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Authenticated users can update user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Authenticated users can delete user_roles" ON public.user_roles;

COMMIT;

-- Verify. user_profiles should show NO insert/update for authenticated or anon;
-- user_roles should list only "user_roles: users read own row".
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'user_profiles'
  AND grantee IN ('authenticated', 'anon')
ORDER BY grantee, privilege_type;

SELECT policyname, cmd FROM pg_policies WHERE tablename = 'user_roles';
