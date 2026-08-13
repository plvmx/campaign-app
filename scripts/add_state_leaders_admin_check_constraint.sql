-- Enforce that state_leaders.admin can only ever be 'AD', 'SR', or NULL.
--
-- Background: the admin column drives login role routing (isRecognizedAdminStatus()
-- in lib/campaignFilter.ts). It was a plain unconstrained TEXT column, and the
-- admin panel's "Admin" field was free text, so a recruiter's name could end up
-- in there instead of a real role code (#78) — silently harmless post-#78 since
-- isRecognizedAdminStatus() treats anything else as "not an admin", but the
-- column stopped meaning what it's supposed to mean. Application-level
-- validation was added in lib/services/stateLeadersService.ts
-- (assertValidAdminValue) and the admin field is now a constrained dropdown;
-- this constraint is the DB-level backstop below both.
--
-- Run this in the Supabase SQL Editor. Run scripts/null_stray_admin_values.js
-- FIRST if it hasn't been already — any existing stray value violates this
-- constraint and the ALTER TABLE below will fail until the data is clean.

ALTER TABLE state_leaders
  ADD CONSTRAINT state_leaders_admin_valid_check
  CHECK (admin IS NULL OR admin IN ('AD', 'SR'));
