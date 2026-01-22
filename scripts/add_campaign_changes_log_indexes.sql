-- Index optimization for campaign_changes_log table
-- These indexes will improve log query performance
-- Run this in Supabase SQL Editor

-- Index on campaign_id (for filtering by campaign)
CREATE INDEX IF NOT EXISTS idx_campaign_changes_log_campaign_id ON campaign_changes_log(campaign_id);

-- Index on user_id (for filtering by user)
CREATE INDEX IF NOT EXISTS idx_campaign_changes_log_user_id ON campaign_changes_log(user_id);

-- Index on change_type (for filtering by change type)
CREATE INDEX IF NOT EXISTS idx_campaign_changes_log_change_type ON campaign_changes_log(change_type);

-- Index on created_at (for date range queries and sorting)
CREATE INDEX IF NOT EXISTS idx_campaign_changes_log_created_at ON campaign_changes_log(created_at);

-- Composite index for common query: campaign_id + created_at
-- Used when filtering by campaign and sorting by date
CREATE INDEX IF NOT EXISTS idx_campaign_changes_log_campaign_created ON campaign_changes_log(campaign_id, created_at);

-- Composite index for common query: change_type + created_at
-- Used when filtering by change type and sorting by date
CREATE INDEX IF NOT EXISTS idx_campaign_changes_log_type_created ON campaign_changes_log(change_type, created_at);
