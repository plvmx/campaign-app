-- Fixes a gap in scripts/create_registry_pipeline_schema.sql: creating the
-- staging/registry schemas and REVOKE-ing anon/authenticated does NOT, by
-- itself, grant service_role anything on them. RLS-bypass (service_role's
-- `bypassrls` attribute) and the ordinary GRANT/REVOKE privilege system are
-- separate — Supabase only auto-configures broad service_role grants for
-- `public` (and its own managed schemas like `auth`/`storage`); a schema we
-- create ourselves starts with no grants for anyone but its owner.
--
-- Confirmed live: the first manual ac-sync invocation against the linked
-- project failed with `permission denied for schema registry | code: 42501`
-- until this was run.
--
-- Run this in the Supabase SQL Editor (idempotent — safe to re-run).

GRANT USAGE ON SCHEMA staging TO service_role;
GRANT USAGE ON SCHEMA registry TO service_role;

GRANT ALL ON ALL TABLES IN SCHEMA staging TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA registry TO service_role;

-- So a table added to either schema later doesn't silently repeat this gap.
ALTER DEFAULT PRIVILEGES IN SCHEMA staging GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA registry GRANT ALL ON TABLES TO service_role;

-- Identity columns (staging.ac_events.id, registry.registration_events.id,
-- registry.sync_log.id) don't need a separate sequence grant — Postgres
-- ties GENERATED ALWAYS AS IDENTITY sequence access to the table's own
-- INSERT privilege, already covered by the table grants above.
