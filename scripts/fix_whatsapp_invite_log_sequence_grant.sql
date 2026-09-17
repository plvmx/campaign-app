-- Fixes a real bug found live 2026-09-17: registry.whatsapp_invite_log's
-- `id` column was declared BIGSERIAL in the original migration
-- (create_registry_whatsapp_invite_log_table.sql), unlike every other
-- table in this schema (staging.ac_events, registry.registration_events,
-- registry.sync_log), which all use BIGINT GENERATED ALWAYS AS IDENTITY.
--
-- That distinction isn't cosmetic: an IDENTITY column's backing sequence
-- is tied to the table's own INSERT privilege (see
-- grant_registry_pipeline_service_role.sql's own comment on this), but a
-- SERIAL column's sequence is a separate object that needs its own
-- explicit grant — one service_role never had here, since neither that
-- script's one-time table GRANT (it predates this table) nor its
-- ALTER DEFAULT PRIVILEGES (covers TABLES, not SEQUENCES) reached it.
--
-- Confirmed live: reported as "new registrations in the last 24h but
-- nothing in the invite log" (Peter, 2026-09-17); a direct test insert
-- reproduced `permission denied for sequence
-- whatsapp_invite_log_id_seq` (42501). Every insert attempt since the
-- table was created has failed the same way — caught by transform.ts's
-- own console-error-only safety net around the log write (deliberately
-- non-fatal, so this never affected the underlying sync or the actual
-- WhatsApp invite sends, which happen before the log write) — so
-- literally zero rows have ever landed in this table. The table is
-- confirmed empty (every failed insert rolled back atomically), so this
-- grant alone is enough; no data migration needed.
--
-- Run this in the Supabase SQL Editor.

GRANT USAGE, SELECT ON SEQUENCE registry.whatsapp_invite_log_id_seq TO service_role;

-- Closes the general gap, not just this one table: ALTER DEFAULT
-- PRIVILEGES ... ON TABLES (already set up in
-- grant_registry_pipeline_service_role.sql) does NOT cover sequences —
-- a distinct object type. Without this, any *future* SERIAL/BIGSERIAL
-- column added anywhere in these two schemas would silently repeat this
-- exact bug. (The three existing GENERATED ALWAYS AS IDENTITY tables
-- don't need this, per the comment above — this is insurance for
-- whatever gets added next, in case it's ever declared SERIAL by
-- mistake, as this one was.)
ALTER DEFAULT PRIVILEGES IN SCHEMA staging GRANT USAGE, SELECT ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA registry GRANT USAGE, SELECT ON SEQUENCES TO service_role;
