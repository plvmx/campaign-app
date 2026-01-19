-- Migration: Add mobile and botj fields to campaigns table
-- Run this in Supabase SQL Editor if the table already exists

ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS mobile TEXT,
ADD COLUMN IF NOT EXISTS botj INTEGER DEFAULT 0;

