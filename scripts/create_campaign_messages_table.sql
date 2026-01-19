-- Create campaign_messages table
CREATE TABLE IF NOT EXISTS campaign_messages (
  date DATE PRIMARY KEY,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add RLS (Row Level Security) policies
ALTER TABLE campaign_messages ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read messages
CREATE POLICY "Anyone can view campaign messages"
  ON campaign_messages
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to insert messages
CREATE POLICY "Authenticated users can insert campaign messages"
  ON campaign_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to update messages
CREATE POLICY "Authenticated users can update campaign messages"
  ON campaign_messages
  FOR UPDATE
  TO authenticated
  USING (true);

-- Allow authenticated users to delete messages
CREATE POLICY "Authenticated users can delete campaign messages"
  ON campaign_messages
  FOR DELETE
  TO authenticated
  USING (true);

-- Create index on date for faster lookups
CREATE INDEX IF NOT EXISTS idx_campaign_messages_date ON campaign_messages(date);
