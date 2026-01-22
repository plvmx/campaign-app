-- Index optimization for results table
-- These indexes will improve results query performance
-- Run this in Supabase SQL Editor

-- Index on campaign_id (already exists but ensuring it's there)
CREATE INDEX IF NOT EXISTS idx_results_campaign_id ON results(campaign_id);

-- Index on user_id (already exists but ensuring it's there)
CREATE INDEX IF NOT EXISTS idx_results_user_id ON results(user_id);

-- Index on category_code (for filtering by category)
CREATE INDEX IF NOT EXISTS idx_results_category_code ON results(category_code);

-- Index on created_at (for sorting)
CREATE INDEX IF NOT EXISTS idx_results_created_at ON results(created_at);

-- Composite index for common query: campaign_id + category_code
-- Used when loading results grouped by category
CREATE INDEX IF NOT EXISTS idx_results_campaign_category ON results(campaign_id, category_code);
