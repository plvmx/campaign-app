-- Comprehensive index optimization for campaigns table
-- These indexes will significantly improve query performance
-- Run this in Supabase SQL Editor

-- Index on date (for date filtering - today, past, upcoming)
CREATE INDEX IF NOT EXISTS idx_campaigns_date ON campaigns(date);

-- Index on state (for state filtering - SR users, admin filters)
CREATE INDEX IF NOT EXISTS idx_campaigns_state ON campaigns(state);

-- Index on leader (for leader filtering - regular users)
CREATE INDEX IF NOT EXISTS idx_campaigns_leader ON campaigns(leader);

-- Index on user_id (for user filtering fallback)
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);

-- Composite index for common query pattern: state + leader
-- Used when filtering by both state and leader
CREATE INDEX IF NOT EXISTS idx_campaigns_state_leader ON campaigns(state, leader);

-- Composite index for date range queries with state
-- Used for date filtering combined with state filtering
CREATE INDEX IF NOT EXISTS idx_campaigns_date_state ON campaigns(date, state);

-- Composite index for the most common query pattern: date + state + leader
-- Used when ordering by date, state, place, time
CREATE INDEX IF NOT EXISTS idx_campaigns_date_state_leader ON campaigns(date, state, leader);

-- Index on created_at for sorting and date range queries
CREATE INDEX IF NOT EXISTS idx_campaigns_created_at ON campaigns(created_at);
