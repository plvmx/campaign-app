-- NOTE: Login now uses /api/auth/validate-leader (service role bypasses RLS).
-- This anon policy is no longer required for sign-in.
--
-- If you need anon SELECT for other reasons, uncomment below:

-- DROP POLICY IF EXISTS "Anon users can read state_leaders for login" ON state_leaders;
-- CREATE POLICY "Anon users can read state_leaders for login"
--   ON state_leaders FOR SELECT TO anon USING (true);
