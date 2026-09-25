-- Extends registry.registrant_edits.field's CHECK constraint to allow
-- 'nfc', now that /registry/manage's Edit mode can hand-flag it
-- (EDITABLE_REGISTRANT_FIELDS in lib/registryPipeline/registrantValidation.ts).
--
-- Peter needed a manual way to set NFC (No Further Contact) after
-- cross-referencing Lorraine's updated soulwinners spreadsheet (24 Sept
-- 2026) found registrants neither ac-sync nor the CSV backfill could
-- resolve on their own — see docs/registry-pipeline/OPERATIONS.md's entry
-- of that date. Without this, PATCH /api/registry/manage-record's audit
-- insert for an nfc edit would fail the CHECK constraint (the edit itself
-- would still succeed and just log the audit failure — see that route's
-- comment on why a logging failure never rolls back the edit — but this
-- closes the gap so nfc edits are attributable like every other field).
--
-- The original CREATE TABLE (create_registry_registrant_edits_table.sql)
-- declared this CHECK inline, so Postgres auto-named it — rather than
-- guess that name, look it up from pg_constraint by the column it
-- actually constrains and drop whatever it's really called, then add the
-- replacement under an explicit name so it's guessable next time.
--
-- Run this in the Supabase SQL Editor.

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
  CHECK (field IN ('first_name', 'last_name', 'state', 'postcode', 'nfc'));
