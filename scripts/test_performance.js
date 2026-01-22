/**
 * Performance Testing Script
 * Run this to test query performance and identify bottlenecks
 * 
 * Usage: node scripts/test_performance.js
 * 
 * Make sure to set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Missing Supabase credentials in .env.local');
  console.error('Required: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function timeQuery(name, queryFn) {
  const start = Date.now();
  try {
    const result = await queryFn();
    const duration = Date.now() - start;
    const count = result?.data?.length || 0;
    console.log(`✓ ${name}: ${duration}ms (${count} rows)`);
    return { duration, count, error: result?.error };
  } catch (error) {
    const duration = Date.now() - start;
    console.error(`✗ ${name}: ${duration}ms - ERROR:`, error.message);
    return { duration, error };
  }
}

async function testPerformance() {
  console.log('\n=== Performance Test Suite ===\n');
  
  // Test 1: Campaign queries (most common)
  console.log('1. Campaign Queries:');
  await timeQuery('  - All campaigns (no filter)', () =>
    supabase.from('campaigns').select('*').order('date', { ascending: true })
  );
  
  await timeQuery('  - Campaigns by state (NSW)', () =>
    supabase.from('campaigns').select('*').eq('state', 'NSW').order('date', { ascending: true })
  );
  
  await timeQuery('  - Campaigns by leader', () =>
    supabase.from('campaigns').select('*').eq('leader', 'Test Leader').order('date', { ascending: true })
  );
  
  await timeQuery('  - Campaigns by date range', () =>
    supabase.from('campaigns').select('*').gte('date', '2024-01-01').lte('date', '2024-12-31')
  );
  
  // Test 2: State leaders queries
  console.log('\n2. State Leaders Queries:');
  await timeQuery('  - All leaders for state', () =>
    supabase.from('state_leaders').select('*').eq('state', 'NSW')
  );
  
  await timeQuery('  - Leader lookup by name', () =>
    supabase.from('state_leaders').select('*').eq('state', 'NSW').ilike('leader', '%Test%')
  );
  
  // Test 3: State places queries
  console.log('\n3. State Places Queries:');
  await timeQuery('  - All places for state', () =>
    supabase.from('state_places').select('*').eq('state', 'NSW')
  );
  
  // Test 4: Results queries
  console.log('\n4. Results Queries:');
  const { data: campaigns } = await supabase.from('campaigns').select('id').limit(5);
  if (campaigns && campaigns.length > 0) {
    const campaignIds = campaigns.map(c => c.id);
    await timeQuery('  - Results by campaign IDs', () =>
      supabase.from('results').select('*').in('campaign_id', campaignIds)
    );
  }
  
  // Test 5: Check indexes
  console.log('\n5. Index Check:');
  const { data: indexes, error: indexError } = await supabase.rpc('exec_sql', {
    query: `
      SELECT tablename, indexname 
      FROM pg_indexes 
      WHERE tablename IN ('campaigns', 'state_leaders', 'state_places', 'results')
      ORDER BY tablename, indexname;
    `
  }).catch(() => ({ data: null, error: 'Cannot check indexes via RPC' }));
  
  if (indexError) {
    console.log('  ⚠ Cannot check indexes automatically. Run check_performance_optimizations.sql manually.');
  } else {
    console.log('  ✓ Index check completed (see results above)');
  }
  
  console.log('\n=== Performance Test Complete ===\n');
  console.log('Expected performance:');
  console.log('  - Simple queries: < 100ms');
  console.log('  - Filtered queries: < 200ms');
  console.log('  - Complex queries: < 500ms');
  console.log('\nIf queries are slower, check:');
  console.log('  1. Database indexes are applied (run add_campaigns_indexes.sql)');
  console.log('  2. Network latency to Supabase');
  console.log('  3. Database size and connection pool');
}

testPerformance().catch(console.error);
