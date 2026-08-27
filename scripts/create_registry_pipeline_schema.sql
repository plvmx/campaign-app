-- AFJ Registry Pipeline — staging + registry schemas.
-- Companion docs: docs/registry-pipeline/BRIEF.md and
-- docs/registry-pipeline/AFJ_PII_Technical_Implementation_Plan.md (Sections 4-5).
--
-- This is a deliberately isolated pair of schemas in the same Supabase
-- project as the rest of this app's tables (which all live in `public`).
-- No client (browser) ever talks to these tables — only the `ac-sync`
-- Edge Function (supabase/functions/ac-sync), running as the service role,
-- reads/writes them. Hence: RLS enabled with no policies (default-deny) AND
-- an explicit REVOKE from anon/authenticated, belt-and-braces.
--
-- Run this in the Supabase SQL Editor.

CREATE SCHEMA IF NOT EXISTS staging;
CREATE SCHEMA IF NOT EXISTS registry;

-- ---------------------------------------------------------------------
-- staging.ac_events — append-only landing zone for raw ActiveCampaign
-- payloads. Nothing is deduplicated or cleaned here; every event, including
-- duplicates across sync runs, lands as its own row. Deduplication happens
-- in the transform step (registry.registrants is keyed on ac_contact_id).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staging.ac_events (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_list_id    TEXT NOT NULL,        -- AC list ID this contact was pulled under ('1' or '2' — see 3.6, Lists 3/5 are excluded before this insert happens)
  ac_contact_id     TEXT,                 -- AC's own contact ID, if present in payload
  event_type        TEXT NOT NULL CHECK (event_type IN ('backfill', 'sync')),
  raw_payload       JSONB NOT NULL,       -- untouched payload as received (contact + fieldValues + contactTags + list status)
  received_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  processed_at      TIMESTAMP WITH TIME ZONE,  -- null until transform step has run
  processing_error  TEXT                  -- populated if transform failed for this row
);

CREATE INDEX IF NOT EXISTS idx_ac_events_unprocessed ON staging.ac_events (processed_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ac_events_contact_id ON staging.ac_events (ac_contact_id);
CREATE INDEX IF NOT EXISTS idx_ac_events_received_at ON staging.ac_events (received_at DESC);

COMMENT ON TABLE staging.ac_events IS 'Raw ActiveCampaign contact payloads as landed by ac-sync, before transform. Retention: see open question in technical plan Section 10 (purge after N days once processed) — not yet implemented.';
COMMENT ON COLUMN staging.ac_events.event_type IS 'backfill = first-ever run (no prior sync_log.completed_at); sync = every incremental run after.';

ALTER TABLE staging.ac_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON staging.ac_events FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- registry.registrants — one row per real person, deduped on AC contact ID.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registry.registrants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ac_contact_id     TEXT UNIQUE NOT NULL,
  full_name         TEXT,
  email             TEXT,
  phone             TEXT,          -- normalized E.164 (see lib/registryPipeline/phone.ts / plan 6.2)
  phone_raw         TEXT,          -- original as received, kept for audit/debugging
  state             TEXT,          -- from AC field [6] "State" (free text) — confirmed canonical, NOT [25] "AU State" (plan 3.4)
  first_seen_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_registrants_state ON registry.registrants (state);

COMMENT ON TABLE registry.registrants IS 'One row per person, deduped on ac_contact_id via upsert in the ac-sync transform step. Field inclusion/exclusion enforced in lib/registryPipeline/fieldMap.ts — never add a column here for an excluded AC field (see plan Section 3.4) without an explicit AFJ leadership decision.';

ALTER TABLE registry.registrants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON registry.registrants FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- registry.known_source_tags — lookup mapping known AC tag IDs to a
-- human-readable source label. Source attribution is tag-based, not
-- list-based: List [1] is a catch-all for 3 of the 4 live registration
-- funnels, so list ID alone cannot identify which page a registrant came
-- through (plan Section 3.3). Seeded here with the confirmed tag map;
-- extend as new sources are identified.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registry.known_source_tags (
  ac_tag_id      TEXT PRIMARY KEY,
  tag_name       TEXT NOT NULL,
  source_label   TEXT NOT NULL
);

COMMENT ON TABLE registry.known_source_tags IS 'Confirmed AC tag ID -> source label map (plan Section 3.3). Read live by the transform step (cached in-memory per run, not per-row) so new sources can be added without a code change.';

INSERT INTO registry.known_source_tags (ac_tag_id, tag_name, source_label) VALUES
  ('21', 'ACTION: Australia For Jesus Commitment',        'register_page'),
  ('48', 'CAMPAIGN: TWOL Sept 2019 Register',              'wayoflife_interest'),
  ('58', 'CAMPAIGN: Bringing Others Webinar: Registered',  'botj_webinar'),
  ('1',  'FORM: Way of life responder: Completed',         'wayoflife_responder')
ON CONFLICT (ac_tag_id) DO UPDATE SET
  tag_name = EXCLUDED.tag_name,
  source_label = EXCLUDED.source_label;

ALTER TABLE registry.known_source_tags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON registry.known_source_tags FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- registry.registration_events — one row per form/list submission,
-- many-to-one against registrants (the same person submitting a second
-- form gets a second event row, not a second registrant row).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registry.registration_events (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  registrant_id     UUID NOT NULL REFERENCES registry.registrants(id) ON DELETE CASCADE,
  source_list_id    TEXT NOT NULL,
  source_tag        TEXT,     -- matched registry.known_source_tags.tag_name, or NULL if no known tag matched
  event_type        TEXT NOT NULL CHECK (event_type IN ('new_registration', 'field_update')),
  occurred_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  raw_staging_id    BIGINT REFERENCES staging.ac_events(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_registration_events_registrant_id ON registry.registration_events (registrant_id);
CREATE INDEX IF NOT EXISTS idx_registration_events_occurred_at ON registry.registration_events (occurred_at DESC);

COMMENT ON TABLE registry.registration_events IS 'One row per AC list/form submission. source_tag is the actual source identifier (plan Section 3.3) — source_list_id alone is not sufficient to tell which page a List-1 registrant came through.';

ALTER TABLE registry.registration_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON registry.registration_events FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- registry.sync_log — audit trail of every ingestion run (and every
-- controlled export, once RLS-scoped views/export RPC ship in a later
-- phase — see plan Section 7.3). This is what the current CSV/email
-- process has no equivalent of.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registry.sync_log (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_type           TEXT NOT NULL CHECK (run_type IN ('sync', 'export')),
  started_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at       TIMESTAMP WITH TIME ZONE,
  records_in         INTEGER,
  records_upserted   INTEGER,
  errors             INTEGER,
  notes              TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_log_started_at ON registry.sync_log (started_at DESC);
-- Used by ac-sync at the start of each run to find the last completed sync's
-- cursor timestamp (`select max(completed_at) ... where run_type = 'sync'`).
CREATE INDEX IF NOT EXISTS idx_sync_log_completed_sync ON registry.sync_log (completed_at DESC) WHERE run_type = 'sync' AND completed_at IS NOT NULL;

COMMENT ON TABLE registry.sync_log IS 'Audit trail of every ac-sync run and every registry export. Not listed in the technical plan''s REVOKE statement (Section 5) but locked down here too, on the same "no client touches registry.* directly" principle (plan Section 2) — this is a deliberate strengthening beyond the plan''s literal text.';

ALTER TABLE registry.sync_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON registry.sync_log FROM anon, authenticated;
