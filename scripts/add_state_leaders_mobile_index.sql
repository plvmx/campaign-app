-- Add index on mobile for faster validateStateLeader lookups
-- Note: Full optimization would require a normalized_mobile column + trigger for client-side normalization
CREATE INDEX IF NOT EXISTS idx_state_leaders_mobile ON state_leaders(mobile) WHERE mobile IS NOT NULL;
