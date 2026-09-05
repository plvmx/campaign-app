-- Fixes the same class of gap scripts/grant_registry_pipeline_service_role.sql
-- fixed for service_role, but for `authenticated`: creating a schema and
-- GRANT-ing SELECT on one table inside it (registry.leader_roles, see
-- scripts/create_registry_leader_roles_table.sql) does NOT by itself let
-- `authenticated` reach it — Postgres also requires USAGE on the schema
-- itself, which is a separate, schema-level privilege. Without this, every
-- client-side query against registry.leader_roles from the /registry
-- portal (lib/registryAuth.ts) fails with
-- "permission denied for schema registry | code: 42501", exactly like the
-- service_role gap did for the Edge Function.
--
-- Run this in the Supabase SQL Editor (idempotent — safe to re-run). Also
-- requires the `registry` schema to already be exposed to PostgREST
-- (Dashboard -> Project Settings -> Data API -> Exposed schemas) — see
-- docs/registry-pipeline/OPERATIONS.md's one-time setup checklist, step 4;
-- that part should already be done from the ac-sync setup.

GRANT USAGE ON SCHEMA registry TO authenticated;

-- Deliberately not `GRANT ALL` here, unlike the service_role script — an
-- authenticated leader should only ever get whatever explicit per-table
-- GRANTs already exist (currently just registry.leader_roles' own
-- `GRANT SELECT ... TO authenticated`, scoped further by its
-- leader_roles_select_own RLS policy to their own row). A future table
-- meant for leader-facing reads needs its own explicit GRANT + RLS policy,
-- the same way leader_roles got both — schema USAGE alone grants nothing
-- on its own.
