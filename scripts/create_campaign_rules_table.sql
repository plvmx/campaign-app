-- Create the campaign_rules table for rules-based campaign generation
CREATE TABLE IF NOT EXISTS campaign_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,                    -- Human-readable rule name
  leader TEXT NOT NULL,                  -- Leader name
  state TEXT NOT NULL,                   -- State
  place TEXT NOT NULL,                   -- Place
  time TIME NOT NULL,                    -- Time (e.g., '10:00:00')
  mobile TEXT,                           -- Optional mobile (from state_leaders lookup)
  
  -- Scheduling Pattern Fields
  frequency_type TEXT NOT NULL CHECK (frequency_type IN ('weekly', 'biweekly', 'monthly', 'custom')),
  frequency_value INTEGER,               -- For biweekly: 2, for monthly: 1, etc.
  
  -- Monthly-specific fields
  month_week_number INTEGER CHECK (month_week_number IN (1, 2, 3, 4, -1)), -- -1 = last week
  month_day_of_week INTEGER CHECK (month_day_of_week BETWEEN 0 AND 6),    -- 0=Sunday, 6=Saturday (optional)
  
  -- Weekly/Biweekly fields
  day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Sunday, 6=Saturday
  
  -- Date range constraints (optional)
  start_date DATE,                       -- Rule becomes active from this date
  end_date DATE,                         -- Rule expires after this date
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,            -- Higher priority rules override lower ones
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  
  -- Additional rule configuration (JSONB for flexibility)
  rule_config JSONB,                     -- For complex patterns, exceptions, etc.
  
  -- Notes/description
  notes TEXT
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_campaign_rules_is_active ON campaign_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_campaign_rules_frequency_type ON campaign_rules(frequency_type);
CREATE INDEX IF NOT EXISTS idx_campaign_rules_leader ON campaign_rules(leader);
CREATE INDEX IF NOT EXISTS idx_campaign_rules_state ON campaign_rules(state);
CREATE INDEX IF NOT EXISTS idx_campaign_rules_place ON campaign_rules(place);
CREATE INDEX IF NOT EXISTS idx_campaign_rules_priority ON campaign_rules(priority DESC);

-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_campaign_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create a trigger to automatically update updated_at on row updates
CREATE TRIGGER update_campaign_rules_updated_at BEFORE UPDATE ON campaign_rules
    FOR EACH ROW EXECUTE FUNCTION update_campaign_rules_updated_at();

-- Add comments to document the table
COMMENT ON TABLE campaign_rules IS 'Stores rules for automatic campaign generation';
COMMENT ON COLUMN campaign_rules.frequency_type IS 'Type of frequency: weekly, biweekly, monthly, or custom';
COMMENT ON COLUMN campaign_rules.month_week_number IS 'Week of month (1-4) or -1 for last week';
COMMENT ON COLUMN campaign_rules.month_day_of_week IS 'Day of week for monthly rules (0=Sunday, 6=Saturday), optional';
COMMENT ON COLUMN campaign_rules.day_of_week IS 'Day of week for weekly/biweekly rules (0=Sunday, 6=Saturday)';
COMMENT ON COLUMN campaign_rules.rule_config IS 'JSONB field for complex patterns, exceptions, and custom configurations';
COMMENT ON COLUMN campaign_rules.priority IS 'Higher priority rules override lower priority ones when conflicts occur';
