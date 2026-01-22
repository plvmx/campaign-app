# Performance Diagnostics Guide

If you're not seeing performance improvements, follow these steps to identify the bottleneck.

## Step 1: Verify Code Changes Are Applied

The optimizations should be visible in the code. Check:

1. **Combined Query Function**: `lib/campaignFilter.ts` should have `getUserAdminStatusAndMobile()`
2. **Caching**: `app/app/page.tsx` should have `placesCache` and `leadersCache` refs
3. **Memoization**: `app/app/page.tsx` should use `useMemo` for `filteredCampaigns`
4. **Parallel Loading**: Initial load should use `Promise.all()`

## Step 2: Check Database Indexes (CRITICAL)

**This is likely the main bottleneck!** Database indexes provide 5-10x performance improvement.

### Check if indexes exist:

1. Open Supabase Dashboard → SQL Editor
2. Run `scripts/check_performance_optimizations.sql`
3. Verify you see indexes for:
   - `campaigns` table: Should have 8+ indexes
   - `campaign_changes_log` table: Should have 6+ indexes  
   - `results` table: Should have 5+ indexes

### Apply indexes if missing:

1. Run `scripts/add_campaigns_indexes.sql`
2. Run `scripts/add_campaign_changes_log_indexes.sql`
3. Run `scripts/add_results_indexes.sql`

**Expected Impact**: 5-10x faster queries after indexes are applied.

## Step 3: Check Browser Console

Open browser DevTools → Console and look for:

```
[Performance] Campaign query took XXXms, returned YYY campaigns
```

**Good performance**: < 200ms
**Poor performance**: > 500ms (likely missing indexes)

## Step 4: Check Network Tab

1. Open DevTools → Network tab
2. Reload the page
3. Look for Supabase requests:
   - Check response times
   - Check if requests are sequential (bad) or parallel (good)

**Expected**: Multiple requests should run in parallel after optimizations.

## Step 5: Test Query Performance

Run the performance test script:

```bash
node scripts/test_performance.js
```

This will show actual query times and help identify slow queries.

## Common Issues

### Issue 1: Database Indexes Not Applied
**Symptom**: Queries take > 500ms
**Solution**: Apply database index scripts (Step 2)

### Issue 2: Network Latency
**Symptom**: All queries are slow, but consistent
**Solution**: 
- Check Supabase region matches your location
- Consider using Supabase connection pooling
- Check network connection quality

### Issue 3: Large Dataset
**Symptom**: Queries are slow even with indexes
**Solution**:
- Consider pagination for large result sets
- Add date range filters to limit data
- Use `.limit()` for initial loads

### Issue 4: Code Not Deployed
**Symptom**: No performance logs in console
**Solution**:
- Rebuild the application: `npm run build`
- Clear browser cache
- Check if running latest code

### Issue 5: Caching Not Working
**Symptom**: Places/leaders load slowly on repeated state changes
**Solution**:
- Check browser console for cache hits
- Verify `placesCache` and `leadersCache` are being used
- Clear cache and test again

## Performance Benchmarks

After optimizations, you should see:

| Operation | Before | After (with indexes) |
|-----------|--------|---------------------|
| Initial page load | 2-4s | 1-2s |
| Campaign query | 500-1000ms | 50-200ms |
| Places/Leaders (cached) | 200-500ms | < 50ms |
| Inline edit load | 500-1000ms | 100-200ms |
| Checkbox toggle | 200-500ms | Instant (optimistic) |

## Still Not Working?

If performance is still poor after:
1. ✅ Code changes applied
2. ✅ Database indexes applied
3. ✅ Browser cache cleared
4. ✅ Application rebuilt

Then the issue is likely:
- **Hosting infrastructure**: Check Vercel/Netlify performance
- **Database region**: Supabase region may be far from users
- **Database size**: Very large datasets may need pagination
- **Network**: User's network connection quality

## Getting Help

If issues persist, provide:
1. Browser console logs (especially performance logs)
2. Network tab screenshots
3. Results from `test_performance.js`
4. Results from `check_performance_optimizations.sql`
