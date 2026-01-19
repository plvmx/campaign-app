-- Create the campaign_changes_log table to record all changes to campaigns
-- This table excludes changes made from the Admin screen

CREATE TABLE IF NOT EXISTS campaign_changes_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('INSERT', 'UPDATE', 'DELETE')),
  old_data JSONB,  -- Previous values (for UPDATE/DELETE)
  new_data JSONB,  -- New values (for INSERT/UPDATE)
  changed_fields TEXT[],  -- Array of field names that changed (for UPDATE)
  user_email TEXT,  -- Denormalized for easier querying
  user_name TEXT,   -- From user_profiles
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_campaign_changes_log_campaign_id ON campaign_changes_log(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_changes_log_user_id ON campaign_changes_log(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_changes_log_created_at ON campaign_changes_log(created_at);
CREATE INDEX IF NOT EXISTS idx_campaign_changes_log_change_type ON campaign_changes_log(change_type);

-- Add comments to document the table
COMMENT ON TABLE campaign_changes_log IS 'Logs all changes to campaigns table, excluding changes from Admin screen';
COMMENT ON COLUMN campaign_changes_log.old_data IS 'Previous values before the change (for UPDATE/DELETE)';
COMMENT ON COLUMN campaign_changes_log.new_data IS 'New values after the change (for INSERT/UPDATE)';
COMMENT ON COLUMN campaign_changes_log.changed_fields IS 'Array of field names that were modified (for UPDATE operations)';
