-- Add team_size field to campaigns table

ALTER TABLE campaigns 
ADD COLUMN team_size INTEGER DEFAULT NULL;

-- Add comment
COMMENT ON COLUMN campaigns.team_size IS 'Number of people in the team for this campaign';

