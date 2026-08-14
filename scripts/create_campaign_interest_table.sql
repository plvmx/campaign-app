-- Records members registering interest in joining a campaign via the
-- Register Interest screen (app/admin/register-interest). One row per
-- (campaign, person) pair — a single submission that ticks several
-- campaigns inserts one row per ticked campaign, all sharing the same
-- name/mobile/interest_type/timestamp.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS campaign_interest (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  -- 'in' = pressed "Yes I'm In", 'more' = pressed "Tell Me More"
  interest_type TEXT NOT NULL CHECK (interest_type IN ('in', 'more')),
  contacted BOOLEAN NOT NULL DEFAULT false,
  contacted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_interest_campaign_id ON campaign_interest(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_interest_contacted ON campaign_interest(contacted);
CREATE INDEX IF NOT EXISTS idx_campaign_interest_created_at ON campaign_interest(created_at DESC);

COMMENT ON TABLE campaign_interest IS 'Members who registered interest in joining a campaign via the Register Interest screen. One row per (campaign, person).';
COMMENT ON COLUMN campaign_interest.interest_type IS '"in" = "Yes I''m In", "more" = "Tell Me More"';
COMMENT ON COLUMN campaign_interest.contacted IS 'Set by a leader/admin once the person has been followed up with.';
COMMENT ON COLUMN campaign_interest.contacted_at IS 'When contacted was last set to true; cleared back to NULL if contacted is unticked.';

-- Row-Level Security: see supabase/rls-policies.sql for the campaign_interest
-- policy. This table holds PII (name + mobile number), so — unlike the
-- permissive "authenticated" policies on campaign_messages/campaign_rules —
-- it's gated by the Postgres-level public.is_admin() check that file already
-- defines and uses for campaigns/state_leaders, not left to app-level checks
-- alone. Run rls-policies.sql (or at least its campaign_interest section)
-- after this script.
ALTER TABLE campaign_interest ENABLE ROW LEVEL SECURITY;
