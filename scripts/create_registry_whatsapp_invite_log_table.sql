-- Audit log for the WhatsApp group invite email (lib/registryPipeline/
-- whatsappInvite.ts, sent from supabase/functions/ac-sync/transform.ts).
--
-- Set up ahead of turning live sending on, so failures and "nothing sent
-- because no link is configured yet" don't go unnoticed the way they would
-- if the only record were a console.error() inside the Edge Function (see
-- docs/registry-pipeline/OPERATIONS.md's entry for this change). One row
-- per invite attempt, not per registrant — a registrant only ever
-- qualifies for one genuine attempt today (shouldSendWhatsAppInvite gates
-- on isNew), but this doesn't assume that stays true forever.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS registry.whatsapp_invite_log (
  id                BIGSERIAL PRIMARY KEY,
  registrant_id     UUID NOT NULL REFERENCES registry.registrants(id),
  raw_staging_id    BIGINT,                  -- the staging.ac_events row that triggered this, same traceability pattern as registration_events.raw_staging_id
  status            TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped_no_link')),
  error             TEXT,                    -- populated only when status = 'failed'
  resend_message_id TEXT,                    -- Resend's own id, for correlating with their dashboard if a delivery issue is ever reported
  included_campaigns_near_me_link BOOLEAN NOT NULL DEFAULT false,
  attempted_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

COMMENT ON TABLE registry.whatsapp_invite_log IS 'One row per WhatsApp invite email attempt (lib/registryPipeline/whatsappInvite.ts). status=''skipped_no_link'' means a registrant qualified but registry.whatsapp_group_links had no ''national'' row yet — distinguishing that from silence is the whole point of this table.';

CREATE INDEX IF NOT EXISTS idx_whatsapp_invite_log_registrant_id ON registry.whatsapp_invite_log(registrant_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_invite_log_attempted_at ON registry.whatsapp_invite_log(attempted_at DESC);

ALTER TABLE registry.whatsapp_invite_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON registry.whatsapp_invite_log FROM anon, authenticated;
-- No policies added — default-deny, same as sync_log/registration_events/etc.
-- Only the service role (ac-sync's db.ts) writes to this table; national
-- registry admins read it via /registry/manage/whatsapp-invite-log
-- (app/api/registry/manage-whatsapp-invite-log/route.ts, using the service
-- role client server-side, same as every other /registry/manage route).
