-- Schema changes for the registrations CSV reload — see
-- docs/registry-pipeline/OPERATIONS.md's two 2026-09-07 entries for the
-- full decision history behind every change here.
--
-- Run this in the Supabase SQL Editor, BEFORE running the reload script,
-- and after taking a backup (scripts/backup_registrants_before_reload.ts).

-- ---------------------------------------------------------------------
-- 1. ac_contact_id is no longer the row's identity — email is (see
--    below). CSV-sourced rows have no AC contact ID at all, so this must
--    become nullable, and it's no longer meaningful as a uniqueness
--    constraint (a single real person having genuinely joined multiple
--    AC contact IDs across different registration forms was Peter's own
--    stated reason for moving away from it as the identity key).
--
--    The constraint being dropped here is Postgres's auto-generated name
--    for the inline `UNIQUE` on the original `CREATE TABLE` (see
--    create_registry_pipeline_schema.sql) — `<table>_<column>_key` is
--    Postgres's standard naming convention for this exact pattern. If
--    this DROP CONSTRAINT fails because the name differs, run
--    `\d registry.registrants` in the SQL Editor to find the real name.
-- ---------------------------------------------------------------------
ALTER TABLE registry.registrants ALTER COLUMN ac_contact_id DROP NOT NULL;
ALTER TABLE registry.registrants DROP CONSTRAINT IF EXISTS registrants_ac_contact_id_key;

COMMENT ON COLUMN registry.registrants.ac_contact_id IS 'The AC contact ID this registrant was last seen under — informational only, not the row''s identity (see email''s unique index below) and not guaranteed unique: the same real person can plausibly hold more than one AC contact ID across different registration forms. NULL for anyone loaded from a spreadsheet import rather than AC sync.';

-- ---------------------------------------------------------------------
-- 2. Normalized email becomes the canonical identity/dedup key, in place
--    of ac_contact_id. Partial (only rows that actually have an email
--    participate — the email-less minority fall back to phone-based
--    matching at the application level, not enforced here as a DB
--    constraint since a bare phone number isn't a safe uniqueness key on
--    its own — households share phones).
--
--    Plain `email` column, not `lower(email)`: PostgREST's upsert
--    `on_conflict` parameter must name a real unique index's columns
--    verbatim, and can't target an expression index. So instead of a
--    case-insensitive expression index, every writer of this column
--    (this reload's script, and supabase/functions/ac-sync/db.ts's
--    upsertRegistrant() from now on) is responsible for lower-casing the
--    email itself before it's ever written here — case-insensitivity is
--    enforced by convention at the write boundary, not by the index.
--
--    Also NOT partial (no `WHERE email IS NOT NULL`), despite that being
--    "the minority of rows participate" the reasoning above suggests —
--    confirmed live 2026-09-09 this breaks PostgREST's upsert entirely
--    (Postgres error 42P10, "no unique or exclusion constraint matching
--    the ON CONFLICT specification"): ON CONFLICT inference only matches
--    a partial index when the statement repeats its exact WHERE
--    predicate, which PostgREST's on_conflict parameter has no way to
--    do. Unnecessary anyway — a plain (non-partial) UNIQUE index already
--    allows any number of NULL emails on its own, since NULL is never
--    considered equal to another NULL for uniqueness purposes. See
--    scripts/fix_registrants_email_unique_index.sql for the live fix.
--
--    This is the conflict target both this reload's own de-duplication
--    and (from this point on) ac-sync's upsertRegistrant() must use for
--    any row that has an email.
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrants_email_unique
  ON registry.registrants (email);

-- ---------------------------------------------------------------------
-- 3. New columns from the CSV reload decisions.
-- ---------------------------------------------------------------------
ALTER TABLE registry.registrants ADD COLUMN IF NOT EXISTS unsubscribed TEXT;
ALTER TABLE registry.registrants ADD COLUMN IF NOT EXISTS nfc TEXT;

COMMENT ON COLUMN registry.registrants.unsubscribed IS 'Set to ''Yes'' when the source data (originally: "UNSUBSCRIBED" embedded in Lorraine''s spreadsheet Church column) indicates this person opted out. NULL otherwise — same raw Yes/no-value string convention as interested_in_training/church_leader (fieldMap.ts), not a boolean. Means "don''t contact them" — deliberately does NOT imply clearing email; email must stay to keep this row matchable under the unique index above if this person is ever seen again.';
COMMENT ON COLUMN registry.registrants.nfc IS 'No Further Contact. Set to ''Yes'' when the source data''s postcode field carried a literal "NFC" marker (Lorraine used the postcode column for this, e.g. "9NFC") instead of a real postcode — the postcode itself is still NULL in that case, same as any other invalid postcode value.';
