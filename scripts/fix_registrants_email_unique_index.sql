-- Fixes a real bug confirmed live 2026-09-09: every ac-sync upsert since
-- the registrations reload failed with
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--   specification" (Postgres error 42P10).
--
-- Root cause: scripts/prepare_registrants_for_csv_reload.sql created
-- idx_registrants_email_unique as a PARTIAL index (`WHERE email IS NOT
-- NULL`). Postgres's ON CONFLICT inference only matches a partial index
-- when the INSERT statement repeats that exact WHERE predicate in its own
-- conflict target — but PostgREST's upsert mechanism (what
-- supabase-js's .upsert(data, {onConflict: 'email'}) generates, used by
-- supabase/functions/ac-sync/db.ts's upsertRegistrant()) has no way to
-- specify a predicate; it always emits a plain `ON CONFLICT (email)`,
-- which can never match a partial index.
--
-- Fix: drop the WHERE clause entirely. It was unnecessary in the first
-- place — a plain (non-partial) UNIQUE index already allows any number of
-- NULL emails on its own (NULL is never considered equal to another NULL
-- for uniqueness purposes in Postgres), so this is the exact same
-- practical behavior, just actually compatible with PostgREST's upsert.
--
-- Run this in the Supabase SQL Editor. Any staging.ac_events rows that
-- failed with this error before the fix are still processed_at IS NULL
-- (markStagingError only records the error, not processed_at) — they'll
-- retry automatically on the next ac-sync invocation, no manual reset
-- needed.

DROP INDEX IF EXISTS registry.idx_registrants_email_unique;
CREATE UNIQUE INDEX idx_registrants_email_unique ON registry.registrants (email);
