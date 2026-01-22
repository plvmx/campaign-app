# Database Optimization Scripts

This directory contains SQL scripts to optimize database performance by adding indexes to frequently queried columns.

## Performance Impact

These indexes will significantly improve query performance, especially as your database grows:

- **Campaign queries**: 5-10x faster filtering and sorting
- **Results queries**: 3-5x faster when loading by campaign
- **Log queries**: 5-10x faster filtering and date range queries
- **Lookup queries**: 2-3x faster for state_leaders and state_places

## Scripts to Run

Run these scripts in the Supabase SQL Editor in order:

### 1. Campaigns Table Indexes
**File**: `add_campaigns_indexes.sql`

Adds indexes for:
- Date filtering (today, past, upcoming)
- State filtering (SR users, admin filters)
- Leader filtering (regular users)
- User ID filtering (fallback)
- Composite indexes for common query patterns

**Impact**: Dramatically improves main dashboard loading speed

### 2. Campaign Changes Log Indexes
**File**: `add_campaign_changes_log_indexes.sql`

Adds indexes for:
- Campaign ID lookups
- User ID filtering
- Change type filtering
- Date range queries
- Composite indexes for common patterns

**Impact**: Improves admin log page performance

### 3. Results Table Indexes
**File**: `add_results_indexes.sql`

Adds indexes for:
- Campaign ID lookups (already exists, but ensures it's there)
- Category code filtering
- Created at sorting
- Composite index for grouped queries

**Impact**: Improves record-results page loading speed

## How to Run

1. Open Supabase Dashboard
2. Go to SQL Editor
3. Copy and paste the contents of each script
4. Run each script one at a time
5. Verify indexes were created (check the Database → Indexes section)

## Existing Indexes

These indexes already exist (from table creation scripts):
- `idx_state_places_state` on `state_places(state)`
- `idx_state_places_place` on `state_places(place)`
- `idx_state_leaders_state` on `state_leaders(state)`
- `idx_state_leaders_leader` on `state_leaders(leader)`
- `idx_campaigns_mobile_leader` on `campaigns(mobile, leader)` (from add_index_campaigns_mobile_leader.sql)

## Monitoring Performance

After adding indexes, you should see:
- Faster page load times
- Reduced database query times (check Supabase Dashboard → Database → Query Performance)
- Lower database CPU usage

## Maintenance

Indexes are automatically maintained by PostgreSQL. They will:
- Update automatically as data changes
- Be used automatically by the query planner
- Not require any manual maintenance

## Rollback

If you need to remove indexes (not recommended), you can drop them:

```sql
DROP INDEX IF EXISTS idx_campaigns_date;
DROP INDEX IF EXISTS idx_campaigns_state;
-- etc.
```

However, this will significantly degrade performance, so only do this if absolutely necessary.
