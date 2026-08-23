-- Widens campaign_interest to accept an email address instead of (or as
-- well as) a mobile number — the public Register Interest form now accepts
-- either, matching training_interest's existing mobile-or-email pattern
-- (see scripts/create_training_interest_table.sql).
--
-- Run this in the Supabase SQL Editor.

ALTER TABLE campaign_interest ALTER COLUMN mobile DROP NOT NULL;
ALTER TABLE campaign_interest ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE campaign_interest DROP CONSTRAINT IF EXISTS campaign_interest_contact_required;
ALTER TABLE campaign_interest
  ADD CONSTRAINT campaign_interest_contact_required
  CHECK (coalesce(trim(mobile), '') <> '' OR coalesce(trim(email), '') <> '');

COMMENT ON COLUMN campaign_interest.mobile IS 'Optional — at least one of mobile/email is required (see campaign_interest_contact_required).';
COMMENT ON COLUMN campaign_interest.email IS 'Optional — at least one of mobile/email is required (see campaign_interest_contact_required).';
