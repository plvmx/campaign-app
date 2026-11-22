-- Extends registry.registrant_edits.field's CHECK constraint to allow
-- 'email' and 'church_name'.
--
--  * 'email' — scripts/cleanup_registrant_duplicates.ts (2026-11-17) logs each
--    repaired email (stray spaces / spreadsheet footnote digit) here.
--  * 'church_name' — /registry/manage's Edit mode has been able to edit the
--    church since 2026-11-14 (EDITABLE_REGISTRANT_FIELDS), but the previous
--    constraint (add_nfc_to_registrant_edits_check.sql) never allowed it, so
--    those audit inserts were being rejected (the edit itself still saved —
--    see /api/registry/manage-record — but wasn't attributable).
--
-- Same drop-by-lookup pattern as add_nfc_to_registrant_edits_check.sql.
-- Run this in the Supabase SQL Editor BEFORE running the cleanup script with
-- --apply.

DO $$
DECLARE
  existing_constraint_name TEXT;
BEGIN
  SELECT con.conname INTO existing_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'registry'
    AND rel.relname = 'registrant_edits'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%field%';

  IF existing_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE registry.registrant_edits DROP CONSTRAINT %I', existing_constraint_name);
  END IF;
END $$;

ALTER TABLE registry.registrant_edits ADD CONSTRAINT registrant_edits_field_check
  CHECK (field IN ('first_name', 'last_name', 'state', 'postcode', 'nfc', 'church_name', 'email'));
