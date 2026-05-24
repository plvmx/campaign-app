-- Tighten the INSERT policy on the results table so a user can only insert
-- rows attributed to themselves (user_id = auth.uid()).
--
-- SELECT / UPDATE / DELETE are left permissive (USING true) because:
--   SELECT  — admins and report generation need to read any campaign's results
--   UPDATE  — (upsert path) may update rows originally inserted by another user
--   DELETE  — admins and shared-access users need to remove results during editing
--
-- Run this in the Supabase SQL Editor.

DROP POLICY IF EXISTS "Authenticated users can insert results" ON results;

CREATE POLICY "Authenticated users can insert results"
  ON results FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
