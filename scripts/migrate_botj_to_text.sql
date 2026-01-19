-- Migration: Change botj field from INTEGER to TEXT with values 'Yes' and 'No'
-- Run this in Supabase SQL Editor

-- Step 1: Add a temporary column
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS botj_temp TEXT DEFAULT 'No';

-- Step 2: Convert existing integer values to text
-- 0 or NULL -> 'No', any other number -> 'Yes'
UPDATE campaigns 
SET botj_temp = CASE 
  WHEN botj IS NULL OR botj = 0 THEN 'No'
  ELSE 'Yes'
END;

-- Step 3: Drop the old column
ALTER TABLE campaigns 
DROP COLUMN IF EXISTS botj;

-- Step 4: Rename the temporary column to botj
ALTER TABLE campaigns 
RENAME COLUMN botj_temp TO botj;

-- Step 5: Set default value
ALTER TABLE campaigns 
ALTER COLUMN botj SET DEFAULT 'No';

-- Step 6: Add constraint to ensure only 'Yes' or 'No' values
ALTER TABLE campaigns 
ADD CONSTRAINT botj_check CHECK (botj IN ('Yes', 'No'));

