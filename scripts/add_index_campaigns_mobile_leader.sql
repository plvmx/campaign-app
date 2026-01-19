-- Migration: Add composite index on (mobile, leader) for campaigns table
-- This index will improve query performance when filtering campaigns by mobile and leader
-- Run this in Supabase SQL Editor

CREATE INDEX IF NOT EXISTS idx_campaigns_mobile_leader ON campaigns(mobile, leader);

