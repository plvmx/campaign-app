-- Audit trail for manual corrections made from the /registry/manage
-- console's View/Edit toggle (First name / Last name / State / Postcode
-- only — see EDITABLE_REGISTRANT_FIELDS in
-- lib/registryPipeline/registrantValidation.ts; Email/Mobile/Date
-- Registered are deliberately never editable from that screen, since
-- email/phone are the pipeline's own identity/dedup keys).
--
-- Without this, a national admin's correction to a registrant's record
-- would be silent and unattributable — no record of who changed what, or
-- what the value was before. registry.sync_log already plays this role
-- for ac-sync runs; this is the equivalent for hand edits.
--
-- Same lockdown pattern as every other registry.* table
-- (create_registry_pipeline_schema.sql): only the service role writes
-- here (via app/api/registry/manage-record/route.ts) or reads here (this
-- console has no "edit history" UI yet — the API only appends rows here,
-- nothing currently queries them back out. That's deliberate: this is a
-- forensic trail for if a correction is later questioned, not a feature
-- in its own right yet).
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS registry.registrant_edits (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  registrant_id    UUID NOT NULL REFERENCES registry.registrants(id) ON DELETE CASCADE,
  field            TEXT NOT NULL CHECK (field IN ('first_name', 'last_name', 'state', 'postcode')),
  old_value        TEXT,
  new_value        TEXT,
  edited_by        UUID NOT NULL,  -- auth.users.id of the admin who made the edit (registry.leader_roles.user_id)
  edited_by_email  TEXT,           -- denormalized at write time, so this trail reads standalone without a join to auth.users
  edited_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_registrant_edits_registrant_id ON registry.registrant_edits (registrant_id);
CREATE INDEX IF NOT EXISTS idx_registrant_edits_edited_at ON registry.registrant_edits (edited_at DESC);

COMMENT ON TABLE registry.registrant_edits IS 'Audit trail of manual corrections to registry.registrants made from the /registry/manage console. Append-only from the app''s side — nothing ever updates or deletes a row here.';

ALTER TABLE registry.registrant_edits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON registry.registrant_edits FROM anon, authenticated;
