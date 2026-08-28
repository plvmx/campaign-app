-- Cleans up registry data landed while AC's list filter was broken
-- (acClient.ts `filters[list]` — fixed in the same PR as this script,
-- see lib/registryPipeline/sync.ts's "Fourth deliberate deviation").
-- List 3 (Business Life) and List 5 (Tony Mclennan) are supposed to be
-- permanently excluded (plan Section 3.6) — List 5 specifically because
-- it carries sensitive financial-intent data. 347 rows landed in
-- staging.ac_events with the wrong list despite every query being for
-- List 1/2; 114 of those reached registry.registration_events before this
-- was caught.
--
-- Run this in the Supabase SQL Editor. Run STEP 0 by itself first and
-- confirm the counts match what's expected below (114 events / 81 fully-
-- contaminated registrants / 32 partially-contaminated) before running
-- the DELETE/UPDATE steps — if the counts don't match, stop and
-- investigate rather than proceeding. Steps 1-4 are safe to run together
-- as one block after that.

-- ---------------------------------------------------------------------
-- STEP 0 — pre-flight check. Run alone; confirm before proceeding.
-- Expected (as of the investigation this script followed):
--   contaminated_events = 114
--   fully_contaminated_registrants = 81   (deleted entirely in step 2)
--   partially_contaminated_registrants = 32  (kept; only their bad event is removed)
-- ---------------------------------------------------------------------
select
  (select count(*) from registry.registration_events where source_list_id in ('3', '5')) as contaminated_events,
  (
    select count(*) from registry.registrants r
    where exists (select 1 from registry.registration_events e where e.registrant_id = r.id and e.source_list_id in ('3','5'))
      and not exists (select 1 from registry.registration_events e where e.registrant_id = r.id and e.source_list_id in ('1','2'))
  ) as fully_contaminated_registrants,
  (
    select count(*) from registry.registrants r
    where exists (select 1 from registry.registration_events e where e.registrant_id = r.id and e.source_list_id in ('3','5'))
      and exists (select 1 from registry.registration_events e where e.registrant_id = r.id and e.source_list_id in ('1','2'))
  ) as partially_contaminated_registrants,
  (select count(*) from staging.ac_events where (raw_payload -> 'listMembership' ->> 'list') in ('3', '5')) as contaminated_staging_rows;

-- ---------------------------------------------------------------------
-- STEP 1 — remove the excluded-list registration events themselves.
-- ---------------------------------------------------------------------
DELETE FROM registry.registration_events
WHERE source_list_id IN ('3', '5');

-- ---------------------------------------------------------------------
-- STEP 2 — remove any registrant now left with zero events at all —
-- i.e. every event they had was from an excluded list, so they should
-- never have been a registrant in the first place.
-- ---------------------------------------------------------------------
DELETE FROM registry.registrants r
WHERE NOT EXISTS (
  SELECT 1 FROM registry.registration_events e WHERE e.registrant_id = r.id
);

-- ---------------------------------------------------------------------
-- STEP 3 — mark the contaminated staging rows as excluded rather than
-- deleting them: staging.ac_events is meant to be an append-only audit
-- trail, so this keeps a record of the incident (what landed, and why it
-- was later excluded) instead of erasing it. Also stops these rows from
-- ever being picked up by a future transform run (processed_at set).
-- ---------------------------------------------------------------------
UPDATE staging.ac_events
SET
  processed_at = COALESCE(processed_at, now()),
  processing_error = COALESCE(processing_error || ' | ', '')
    || 'excluded: List 3/5 data-governance cleanup (acClient.ts list-filter fix)'
WHERE (raw_payload -> 'listMembership' ->> 'list') IN ('3', '5');

-- ---------------------------------------------------------------------
-- STEP 4 — post-cleanup verification. Expect all zeros / no remaining
-- active contamination.
-- ---------------------------------------------------------------------
select
  (select count(*) from registry.registration_events where source_list_id in ('3', '5')) as remaining_contaminated_events,
  (select count(*) from registry.registrants r where not exists (select 1 from registry.registration_events e where e.registrant_id = r.id)) as orphaned_registrants,
  (select count(*) from staging.ac_events where (raw_payload -> 'listMembership' ->> 'list') in ('3','5') and processed_at is null) as unmarked_contaminated_staging_rows;
