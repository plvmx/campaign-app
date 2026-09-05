-- Adds registry.registrants.postcode.
--
-- Reverses the original plan Section 3.4/3.5 exclusion ("not currently
-- capturable — data loss identified") — that was a landing-page bug
-- (postcode never reached AC at all, on any submission), not a deliberate
-- design decision. Confirmed fixed upstream and live-tested by Peter: two
-- real test registrations landed real postcode values on AC custom field
-- [30] "Post Code" (created 2026-08-26, per a fresh ac_discovery.js run —
-- i.e. the field itself is brand new).
--
-- Historical registrants will NOT be retroactively backfilled with
-- postcode by AC — this only appears on registrations from ~2026-08-26
-- onward. `postcode IS NULL` is therefore expected and normal for anyone
-- registered before then, not a data-quality problem to chase.
--
-- Run this in the Supabase SQL Editor.

ALTER TABLE registry.registrants ADD COLUMN IF NOT EXISTS postcode TEXT;

COMMENT ON COLUMN registry.registrants.postcode IS 'From AC custom field [30] "Post Code", added 2026-08-26. NULL for any registrant synced from data submitted before that date — not backfilled, by AC''s own confirmation, not a pipeline gap.';
