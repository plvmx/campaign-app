-- URGENT: the existing CHECK constraint on results.category_code allows only
-- {'P','F','SP','IR'} — it rejects 'TM' (Team Members). The client has been
-- writing 'TM' for the Team Members section forever, so every save batch that
-- included a Team Member was rejected wholesale (Postgres INSERT is atomic)
-- and the user saw "Save failed". This was masked in production until the
-- Tier 1 audit log went live, where 405 rejected batches in one day made it
-- visible.
--
-- Verified via scripts/probe_category_codes.js:
--   * 'TM' rejected with code 23514 / "violates check constraint results_category_code_check"
--   * 'P', 'F', 'SP', 'IR' accepted
--   * Zero existing rows in the table carry category_code = 'TM'
--
-- Fix: replace the constraint with one that also allows 'TM'.
--
-- Run this in the Supabase SQL Editor.

ALTER TABLE results DROP CONSTRAINT IF EXISTS results_category_code_check;

ALTER TABLE results ADD CONSTRAINT results_category_code_check
  CHECK (category_code IN ('TM', 'P', 'F', 'SP', 'IR'));

COMMENT ON CONSTRAINT results_category_code_check ON results IS
  'Allowed category codes: TM = Team Member, P = Partial, F = Full, SP = Full + Sinner''s Prayer, IR = Information Request.';
