-- Fix the first_name column size in results table
-- The column is currently limited to 4 characters, which is causing names to be truncated
-- This script will alter the column to allow longer names (VARCHAR(255))

ALTER TABLE results
ALTER COLUMN first_name TYPE VARCHAR(255);

-- Add a comment to document the change
COMMENT ON COLUMN results.first_name IS 'First name of the person (up to 255 characters)';
