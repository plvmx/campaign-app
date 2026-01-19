-- Add tl_ok and sr_ok fields to campaigns table
-- These fields are boolean flags that can be set via checkboxes

ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS tl_ok BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS sr_ok BOOLEAN DEFAULT false;

-- Add comments to document the fields
COMMENT ON COLUMN campaigns.tl_ok IS 'Team Leader OK flag';
COMMENT ON COLUMN campaigns.sr_ok IS 'State Reporter OK flag';
