-- Leader-level sharing: (owner_state, owner_leader) shares all their campaigns with (shared_with_state, shared_with_leader).
-- One row = one direction. For mutual sharing, create two rows (A→B and B→A).
CREATE TABLE IF NOT EXISTS leader_shares (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_state TEXT NOT NULL,
  owner_leader TEXT NOT NULL,
  shared_with_state TEXT NOT NULL,
  shared_with_leader TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(owner_state, owner_leader, shared_with_state, shared_with_leader)
);

CREATE INDEX IF NOT EXISTS idx_leader_shares_shared_with ON leader_shares(shared_with_state, shared_with_leader);
CREATE INDEX IF NOT EXISTS idx_leader_shares_owner ON leader_shares(owner_state, owner_leader);

COMMENT ON TABLE leader_shares IS 'Leader-to-leader sharing: campaigns created by (owner_state, owner_leader) are visible to (shared_with_state, shared_with_leader). Applies to all current and future campaigns.';
