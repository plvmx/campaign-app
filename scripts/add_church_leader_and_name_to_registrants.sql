-- Adds registry.registrants.church_leader and .church_name.
--
-- Reverses two exclusions from the original plan Section 3.4 — both were
-- explicitly "Confirmed by AFJ leadership" as excluded ("Sensitive-adjacent;
-- leadership decision" for Church Leader?). Peter confirmed directly
-- (2026-09-01) that this data is now needed after all.
--
-- Each reads the newer form field with the older one as fallback, the same
-- old/new pairing already used for state (plan Section 3.4's confirmed
-- State [6]/AU State [25] canonical/fallback):
--   church_leader <- AC field [28] "Are you a church leader?" (dropdown),
--                     falling back to [10] "Church Leader?" (hidden)
--   church_name   <- AC field [26] "What Church do you attend?" (text),
--                     falling back to [14] "Church Name" (text)
--
-- Run this in the Supabase SQL Editor.

ALTER TABLE registry.registrants ADD COLUMN IF NOT EXISTS church_leader TEXT;
ALTER TABLE registry.registrants ADD COLUMN IF NOT EXISTS church_name TEXT;

COMMENT ON COLUMN registry.registrants.church_leader IS 'AC field [28] "Are you a church leader?" (fallback [10] "Church Leader?") — raw value (e.g. "Yes"/"No"). Reverses the plan''s original exclusion, per Peter 2026-09-01.';
COMMENT ON COLUMN registry.registrants.church_name IS 'AC field [26] "What Church do you attend?" (fallback [14] "Church Name"). Reverses the plan''s original exclusion, per Peter 2026-09-01.';
