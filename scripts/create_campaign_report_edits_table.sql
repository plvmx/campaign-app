-- Campaign Report project — see docs/campaign-report/BRIEF.md.
--
-- Append-only audit trail of hand edits made to a campaign_reports row's
-- derived_state / derived_place / derived_leader from /admin/campaign-reports
-- (the same idea as registry.registrant_edits). Written by the service role
-- only; admin-read RLS. A log table, so excluded from BACKUP_TABLE_CONFIG.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS campaign_report_edits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES campaign_reports(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  edited_by UUID,
  edited_by_label TEXT,
  edited_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_report_edits_edited_at
  ON campaign_report_edits(edited_at DESC);

ALTER TABLE campaign_report_edits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_report_edits: admin can read" ON campaign_report_edits;
CREATE POLICY "campaign_report_edits: admin can read"
  ON campaign_report_edits FOR SELECT TO authenticated
  USING (public.is_admin());

-- No authenticated write policy — service role only.
