-- Create the state_leaders lookup table
CREATE TABLE IF NOT EXISTS state_leaders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  state TEXT NOT NULL,
  leader TEXT NOT NULL,
  mobile TEXT,
  admin TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(state, leader)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_state_leaders_state ON state_leaders(state);
CREATE INDEX IF NOT EXISTS idx_state_leaders_leader ON state_leaders(leader);

