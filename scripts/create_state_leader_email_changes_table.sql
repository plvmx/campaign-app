-- Audit trail for every change to state_leaders.email — both the
-- self-serve magic-link flow (app/api/auth/confirm-email/route.ts) and
-- direct admin edits (lib/services/stateLeadersService.ts's
-- createStateLeader/updateStateLeader, from /admin/state-leaders).
--
-- Without this, a leader's captured email could be silently overwritten
-- with no record of what it used to be or who/what changed it. Same
-- rationale as scripts/create_registry_registrant_edits_table.sql,
-- adapted for this table's simpler single-column concern.
--
-- RLS/policies are NOT defined here — see supabase/rls-policies.sql's
-- "state_leader_email_changes" section, following the same split already
-- used for campaign_changes_log (table DDL here, policies centralized
-- there) rather than the registry schema's inline REVOKE ALL pattern,
-- which doesn't apply: this table lives in public, which IS exposed via
-- PostgREST, unlike registry.*.
--
-- Deliberately excluded from lib/services/backupService.ts's
-- BACKUP_TABLE_CONFIG — same reasoning as campaign_changes_log: this is
-- operational/audit history, reconstructable from nothing but its own
-- accumulation, not admin-curated content.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS state_leader_email_changes (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  state_leader_id UUID NOT NULL REFERENCES state_leaders(id) ON DELETE CASCADE,
  old_email       TEXT,
  new_email       TEXT,
  changed_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  source          TEXT NOT NULL CHECK (source IN ('self-serve', 'admin'))
);

CREATE INDEX IF NOT EXISTS idx_state_leader_email_changes_state_leader_id
  ON state_leader_email_changes (state_leader_id);
CREATE INDEX IF NOT EXISTS idx_state_leader_email_changes_changed_at
  ON state_leader_email_changes (changed_at DESC);

COMMENT ON TABLE state_leader_email_changes IS 'Append-only audit trail of state_leaders.email changes — who/what changed it (source) and the before/after value. Never updated or deleted from the app.';
