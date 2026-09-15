-- Adds registry.registrants.webinar_session_at, .webinar_attended,
-- .code_of_conduct_agreed, and .code_of_conduct_agreed_at.
--
-- Four fields from Lorraine's registrations CSV ("Webinar", "W/Done",
-- "Code", "Date Agreed") originally scoped OUT of the Sept 2026 CSV reload
-- as workflow-tracking columns with no clear need (see OPERATIONS.md).
-- That need has now emerged. None of these turned out to be what they
-- first looked like — traced against a live ActiveCampaign API query (28
-- total contact custom fields, confirmed exhaustive) and cross-checked
-- against Jordan's own AC-derived tracking spreadsheet before writing this:
--
--   webinar_session_at        <- AC custom field [24] "BOTJ Webinar
--                                 Session" (datetime) — already whitelisted
--                                 in fieldMap.ts but never promoted to a
--                                 column until now. Confirmed live against
--                                 8 shared records between the CSV's
--                                 "Webinar" column and Jordan's own
--                                 "Session Date" column — always an exact
--                                 match, including time-of-day. NOT field
--                                 [23] "BOTJ Webinar Rego Date" (a
--                                 date-only field, and consistently a
--                                 different, earlier value) — that field
--                                 remains unpromoted; nothing sources it.
--   webinar_attended           <- NOT an AC custom field at all (confirmed
--                                 live — no field named "Attended" exists).
--                                 Derived from AC tags: tag 60 "CAMPAIGN:
--                                 Bringing Others Webinar: Attended" ->
--                                 'Yes'; tag 56 "...: Missed" -> 'No'
--                                 (name-inferred, part of AC's own matched
--                                 56-61 tag set, not yet confirmed applied
--                                 in practice — see tagDerivedFields.ts).
--                                 Note: AC's own tracking data shows
--                                 Attended as Yes-or-blank only in every
--                                 sampled case, so an explicit 'No' here
--                                 will likely only ever come from the CSV
--                                 backfill, not a live AC sync.
--   code_of_conduct_agreed     <- NOT a "Code of Conduct" field in AC
--                                 either (confirmed live — zero hits for
--                                 any such field or tag). Peter confirmed
--                                 it means "this registrant has a genuine
--                                 /thewayoflife/ registration" — derived
--                                 from the presence of AC tag 48 "CAMPAIGN:
--                                 TWOL Sept 2019 Register" (an oddly-named
--                                 but already-seeded registry.known_source_tags
--                                 row for the /thewayoflife/ funnel).
--                                 Checked as raw tag presence, not via
--                                 sourceAttribution.matchSourceTag, whose
--                                 first-match-wins behaviour would be wrong
--                                 for a multi-funnel contact.
--   code_of_conduct_agreed_at  <- that same tag 48's own `cdate` (when AC
--                                 applied it), from GET
--                                 /contacts/{id}/contactTags. Confirmed
--                                 live to match the CSV's "Date Agreed"
--                                 column exactly. The contact's own cdate
--                                 (registered_at) is NOT a usable proxy —
--                                 a live example differed by ~6 months.
--
-- Historical (pre-Sept-2026-reload) registrants only ever get these four
-- fields from the one-off CSV backfill (scripts/backfill_webinar_and_code_fields_from_csv.ts)
-- — ac-sync only derives them for contacts it actually re-syncs after this
-- migration + a redeploy. See CLAUDE.md's "Registry pipeline" section for
-- the full column list and derivation rules.
--
-- Run this in the Supabase SQL Editor.

ALTER TABLE registry.registrants ADD COLUMN IF NOT EXISTS webinar_session_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE registry.registrants ADD COLUMN IF NOT EXISTS webinar_attended TEXT;
ALTER TABLE registry.registrants ADD COLUMN IF NOT EXISTS code_of_conduct_agreed TEXT;
ALTER TABLE registry.registrants ADD COLUMN IF NOT EXISTS code_of_conduct_agreed_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN registry.registrants.webinar_session_at IS 'AC field [24] "BOTJ Webinar Session" (datetime) — the session they registered for/attended, not the [23] "Rego Date" (unpromoted, no CSV equivalent). Also from CSV column "Webinar".';
COMMENT ON COLUMN registry.registrants.webinar_attended IS 'Not an AC field — derived from tag 60 "...Attended" (Yes) / tag 56 "...Missed" (No, name-inferred). CSV column "W/Done". See lib/registryPipeline/tagDerivedFields.ts.';
COMMENT ON COLUMN registry.registrants.code_of_conduct_agreed IS 'Not an AC field — ''Yes'' when tag 48 "CAMPAIGN: TWOL Sept 2019 Register" (the /thewayoflife/ funnel tag) is present, else null. Never ''No''. CSV column "Code".';
COMMENT ON COLUMN registry.registrants.code_of_conduct_agreed_at IS 'Tag 48''s own cdate (when AC applied it) — NOT contact.cdate/registered_at, which can differ by months. CSV column "Date Agreed".';
