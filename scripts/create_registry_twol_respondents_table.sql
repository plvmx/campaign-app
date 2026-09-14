-- registry.twol_respondents — people a TWOL presenter reported presenting
-- "The Way Of Life" message to, via the `/wayoflife-responder/` AC form
-- (AC List `[2]`, tag `[1] FORM: Way of life responder: Completed` — see
-- docs/registry-pipeline/AFJ_PII_Technical_Implementation_Plan.md Section
-- 3.3). This form is filled in BY THE PRESENTER, about someone else,
-- after a conversation — not a self-registration. It has no Postcode
-- field at all (unlike /register/ and /thewayoflife/, where a postcode IS
-- shown but is separately lost before reaching AC — see the plan's
-- Section 3.5 data-quality note), and its contact details are third-party
-- transcriptions, not self-entered — more error-prone (a real example
-- surfaced 2026-09-14: an email landed as "...@yahoo.con", plausibly
-- mis-heard/mis-typed by the presenter, not the actual person).
--
-- Previously these contacts were upserted straight into registry.registrants
-- like any other AC List-1 registrant, which was wrong: they never went
-- through a registration funnel themselves, so they shouldn't count as
-- registrants, get the WhatsApp group invite email
-- (lib/registryPipeline/whatsappInvite.ts), or affect /registry/manage's
-- counts. Fixed 2026-09-14 by routing AC List `[2]` events here instead —
-- see lib/registryPipeline/transform.ts. List `[2]` is deliberately keyed
-- on here (not the tag, as everywhere else in this pipeline) because it
-- has been confirmed, repeatedly, to be the sole use of that list (see
-- OPERATIONS.md's "List 1 new registrations, List 2 individual
-- wayoflife-responder outcomes" line) — unlike List `[1]`, which is a
-- genuine catch-all and cannot be trusted this way.
--
-- Append-only, one row per form submission (not deduped by email like
-- registrants — the same person can plausibly be the subject of more than
-- one presenter's report over time, and each is its own real event).
--
-- Existing registrants that were incorrectly created from this source
-- before this fix were moved here by
-- scripts/migrate_wayoflife_responders_to_twol_respondents.ts — run once,
-- 2026-09-14. A registrant who ALSO has a genuine List-1 registration
-- event was left in registry.registrants (they really did register
-- themselves at some point; being separately reported via this form too
-- doesn't change that) — only registrants whose *only* registration_events
-- were List `[2]` were moved.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS registry.twol_respondents (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ac_contact_id     TEXT,          -- AC contact ID this submission was recorded against — not unique here (unlike registrants.ac_contact_id historically), since the same contact can be the subject of more than one submission
  first_name        TEXT,
  last_name         TEXT,
  email             TEXT,
  phone             TEXT,          -- normalized E.164 (lib/registryPipeline/phone.ts), same as registrants.phone
  phone_raw         TEXT,          -- original as received, kept for audit/debugging
  state             TEXT,          -- from AC field [6] "State" (free text) — same canonical field as registrants.state
  registered_at     TIMESTAMP WITH TIME ZONE,  -- AC's own contact.cdate
  source_tag        TEXT,          -- matched registry.known_source_tags.tag_name — expected to always be 'FORM: Way of life responder: Completed', but not enforced, in case this table is ever reused
  raw_staging_id    BIGINT REFERENCES staging.ac_events(id) ON DELETE SET NULL,
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_twol_respondents_email ON registry.twol_respondents (email);
CREATE INDEX IF NOT EXISTS idx_twol_respondents_created_at ON registry.twol_respondents (created_at DESC);

COMMENT ON TABLE registry.twol_respondents IS 'One row per /wayoflife-responder/ (AC List [2]) form submission — someone a TWOL presenter reported presenting "The Way Of Life" to. Third-party-submitted, not a self-registration: never promoted to registry.registrants, never triggers the WhatsApp invite email. See lib/registryPipeline/transform.ts.';

-- Same lock-down as every other table in this schema (create_registry_pipeline_schema.sql's
-- header comment): no client ever queries these tables directly, only the
-- ac-sync Edge Function via the service role.
ALTER TABLE registry.twol_respondents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON registry.twol_respondents FROM anon, authenticated;
