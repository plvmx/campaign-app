-- Create the state_places lookup table
CREATE TABLE IF NOT EXISTS state_places (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  state TEXT NOT NULL,
  place TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(state, place)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_state_places_state ON state_places(state);
CREATE INDEX IF NOT EXISTS idx_state_places_place ON state_places(place);

