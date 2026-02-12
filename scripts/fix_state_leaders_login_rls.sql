-- Remove the anon SELECT policy on state_leaders (if present).
--
-- If you previously added "Anon users can read state_leaders for login" to fix
-- the lockout, run this after creating validate_leader_for_login. The RPC
-- handles login validation without exposing state_leaders to anon.

DROP POLICY IF EXISTS "Anon users can read state_leaders for login" ON state_leaders;
