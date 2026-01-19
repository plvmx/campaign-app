-- Drop the potential_campaigns table
-- This table is no longer needed as its functionality has been replaced by:
-- - state_places table (for place lookups)
-- - state_leaders table (for leader lookups)
-- - campaigns table (for actual campaign data)

-- Note: This will permanently delete all data in the potential_campaigns table
-- Make sure to backup any important data before running this script

DROP TABLE IF EXISTS potential_campaigns CASCADE;
