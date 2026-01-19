-- Add count fields to campaigns table
-- These fields store numeric counts (no decimals) for different categories

ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS pp_cnt INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS fp_cnt INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS fpsp_cnt INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS ir_cnt INTEGER DEFAULT 0;

-- Add comments to document the fields
COMMENT ON COLUMN campaigns.pp_cnt IS 'Count for PP category';
COMMENT ON COLUMN campaigns.fp_cnt IS 'Count for FP category';
COMMENT ON COLUMN campaigns.fpsp_cnt IS 'Count for FPSP category';
COMMENT ON COLUMN campaigns.ir_cnt IS 'Count for IR category';
