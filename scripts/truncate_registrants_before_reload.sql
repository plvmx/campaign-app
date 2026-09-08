-- Wipes registry.registrants and registry.registration_events completely,
-- ahead of scripts/reload_registrants_from_csv.ts --apply.
--
-- DO NOT RUN THIS without first:
--   1. Taking a backup: npx tsx scripts/backup_registrants_before_reload.ts
--   2. Running scripts/prepare_registrants_for_csv_reload.sql (the new
--      columns / nullable ac_contact_id / email unique index)
--
-- Confirmed live 2026-09-07, before this was run: 9,134 registrants,
-- 36,498 registration_events. This deletes all of it. There is no undo
-- other than restoring from the backup above.
--
-- registration_events first (FK-safe order — it references registrants.id),
-- so registrants can be truncated afterward with no CASCADE needed.
-- RESTART IDENTITY only actually resets registration_events.id (a real
-- identity column) — registrants.id is a UUID default
-- (gen_random_uuid()), so the same clause there is a harmless no-op, kept
-- for symmetry.

TRUNCATE registry.registration_events RESTART IDENTITY;
TRUNCATE registry.registrants RESTART IDENTITY;
