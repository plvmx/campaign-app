-- Allow two attendees with the same first name to coexist in the same
-- (campaign, category). Today the table has a unique constraint
--
--   results_campaign_id_first_name_category_code_key
--     UNIQUE (campaign_id, first_name, category_code)
--
-- which silently drops the second "John" / second "Mary" via upsert
-- conflict resolution. The `id uuid` primary key already exists on the
-- table, so each row already has a stable identity — we just need to
-- stop enforcing name-as-identity, and switch the client over to
-- operating by id (separate PR).
--
-- Verified via scripts/check_results_constraints.js: inserting a duplicate
-- (campaign_id, first_name, category_code) errors with code 23505
-- referencing exactly the constraint name dropped below.
--
-- Run this in the Supabase SQL Editor.

ALTER TABLE results DROP CONSTRAINT IF EXISTS results_campaign_id_first_name_category_code_key;

-- The index automatically created by that constraint is dropped with it.
-- The composite index used for fast filtering by (campaign_id, category_code)
-- is a separate object (idx_results_campaign_category, from
-- scripts/add_results_indexes.sql) and is unaffected.

COMMENT ON TABLE results IS
  'Per-attendee record for a campaign. Each row keyed by id (uuid). Two attendees with the same first name in the same category are now allowed and stored as separate rows.';
