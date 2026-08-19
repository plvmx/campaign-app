-- Records members expressing interest in joining a training session (a
-- campaign with category BOTJ or TLT) via its per-campaign public link
-- (/public/training/[campaignId]). One row per (campaign, person) — there is
-- no interest_type here (unlike campaign_interest): a single "I'm
-- Interested" action, not a choice between two responses.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS training_interest (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- At least one of mobile/email must be provided — enforced below.
  mobile TEXT,
  email TEXT,
  contacted BOOLEAN NOT NULL DEFAULT false,
  contacted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT training_interest_contact_required
    CHECK (coalesce(trim(mobile), '') <> '' OR coalesce(trim(email), '') <> '')
);

CREATE INDEX IF NOT EXISTS idx_training_interest_campaign_id ON training_interest(campaign_id);
CREATE INDEX IF NOT EXISTS idx_training_interest_contacted ON training_interest(contacted);
CREATE INDEX IF NOT EXISTS idx_training_interest_created_at ON training_interest(created_at DESC);

COMMENT ON TABLE training_interest IS 'Members who expressed interest in joining a training session (campaign category BOTJ/TLT) via its public link. One row per (campaign, person).';
COMMENT ON COLUMN training_interest.mobile IS 'Optional — at least one of mobile/email is required (see training_interest_contact_required).';
COMMENT ON COLUMN training_interest.email IS 'Optional — at least one of mobile/email is required (see training_interest_contact_required).';
COMMENT ON COLUMN training_interest.contacted IS 'Set by the training leader/admin once the person has been followed up with.';
COMMENT ON COLUMN training_interest.contacted_at IS 'When contacted was last set to true; cleared back to NULL if contacted is unticked.';

-- Row-Level Security: see supabase/rls-policies.sql for the training_interest
-- policy. This table holds PII (name + mobile/email), so — like
-- campaign_interest — it's gated by Postgres-level checks rather than
-- app-level checks alone: admins can read/update every row, and a leader can
-- read/update rows only for campaigns they lead (own or shared via
-- leader_shares), mirroring the campaigns table's own policy. Public
-- submissions never go through the browser client (anonymous visitors have
-- no RLS access) — they insert via the service role in
-- app/api/public/training-interest/[campaignId]/route.ts instead. Run
-- rls-policies.sql (or at least its training_interest section) after this
-- script.
ALTER TABLE training_interest ENABLE ROW LEVEL SECURITY;
