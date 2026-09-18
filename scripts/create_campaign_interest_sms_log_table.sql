-- Audit log for the "text the leader" SMS sent when someone registers interest
-- in their campaign (lib/services/campaignInterestSmsService.ts), triggered from
-- app/api/public/register-interest/route.ts and
-- app/api/public/campaigns-near-me/route.ts.
--
-- One row per leader per submission (not per campaign) — a submission ticking
-- several campaigns led by the same leader sends that leader one combined text,
-- so campaign_ids is an array rather than a single foreign key.
--
-- Set up from the start (not added after an incident) so a misconfiguration or
-- delivery failure doesn't go unnoticed the way registry.whatsapp_invite_log's
-- own gap did for two days before it had a dedicated log table — see that
-- table's own comment and docs/registry-pipeline/OPERATIONS.md's 2026-09-17
-- entry for the incident this design is deliberately avoiding a repeat of.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS campaign_interest_sms_log (
  -- BIGINT GENERATED ALWAYS AS IDENTITY, not BIGSERIAL — an IDENTITY column's
  -- backing sequence is covered by service_role's table-level INSERT grant; a
  -- SERIAL column's sequence is a separate object needing its own grant, which
  -- registry.whatsapp_invite_log shipped without and silently failed every
  -- insert for two days as a result. See that table's own comment.
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  state                 TEXT NOT NULL,
  leader                TEXT NOT NULL,
  mobile                TEXT,                    -- null when status = 'skipped_no_mobile'
  campaign_ids          UUID[] NOT NULL,
  interest_type         TEXT NOT NULL CHECK (interest_type IN ('in', 'more')),
  message_body          TEXT,
  status                TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped_no_mobile')),
  error                 TEXT,                    -- populated only when status = 'failed'
  clicksend_message_id  TEXT,                    -- ClickSend's own id, for correlating with their dashboard
  attempted_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

COMMENT ON TABLE campaign_interest_sms_log IS 'One row per leader-notification SMS attempt (lib/services/campaignInterestSmsService.ts). status=''skipped_no_mobile'' means the leader has no mobile on file in state_leaders.';

CREATE INDEX IF NOT EXISTS idx_campaign_interest_sms_log_attempted_at ON campaign_interest_sms_log(attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_interest_sms_log_state_leader ON campaign_interest_sms_log(state, leader);

-- Row-Level Security: see supabase/rls-policies.sql for the
-- campaign_interest_sms_log policy. Only the service role writes here (from
-- the public API routes above); no INSERT/UPDATE/DELETE policy is needed for
-- that, since the service role bypasses RLS entirely — same as
-- registry.whatsapp_invite_log. Admins can read via the app.
ALTER TABLE campaign_interest_sms_log ENABLE ROW LEVEL SECURITY;
