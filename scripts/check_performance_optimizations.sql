-- Diagnostic script to check if database indexes exist
-- Run this in Supabase SQL Editor to verify indexes are in place

-- Check campaigns table indexes
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'campaigns'
ORDER BY indexname;

-- Check campaign_changes_log table indexes
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'campaign_changes_log'
ORDER BY indexname;

-- Check results table indexes
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'results'
ORDER BY indexname;

-- Check state_leaders table indexes
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'state_leaders'
ORDER BY indexname;

-- Check state_places table indexes
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'state_places'
ORDER BY indexname;

-- Summary: Count indexes per table
SELECT 
    tablename,
    COUNT(*) as index_count
FROM pg_indexes
WHERE tablename IN ('campaigns', 'campaign_changes_log', 'results', 'state_leaders', 'state_places')
GROUP BY tablename
ORDER BY tablename;
