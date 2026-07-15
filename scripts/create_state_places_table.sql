-- Create the state_places lookup table
-- Note: existing databases should apply docs/migrations/005_add_site_column.sql
-- instead of re-running this script, which only covers a fresh install.
CREATE TABLE IF NOT EXISTS state_places (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  state TEXT NOT NULL,
  place TEXT NOT NULL,
  site TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(state, place, site)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_state_places_state ON state_places(state);
CREATE INDEX IF NOT EXISTS idx_state_places_place ON state_places(place);

