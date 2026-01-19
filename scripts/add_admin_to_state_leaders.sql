-- Migration: Add admin column to state_leaders table
-- Run this in Supabase SQL Editor if the table already exists

ALTER TABLE state_leaders 
ADD COLUMN IF NOT EXISTS admin TEXT;

