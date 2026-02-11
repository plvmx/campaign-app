-- Add source field to campaigns table
-- Values: 'MAN' = manual, 'CFP' = copied from past week, 'RUL' = created by campaign rule

ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS source TEXT;

-- Add comment to document the field
COMMENT ON COLUMN campaigns.source IS 'Origin: MAN=manual, CFP=copied from past week, RUL=created by campaign rule';

-- Optional: Add check constraint to enforce valid values (uncomment if desired)
-- ALTER TABLE campaigns ADD CONSTRAINT campaigns_source_check
--   CHECK (source IS NULL OR source IN ('MAN', 'CFP', 'RUL'));
