/**
 * Vercel Cron — Weekly Campaign Refresh
 *
 * Scheduled to run every Sunday at 01:00 UTC (see vercel.json).
 * Vercel automatically attaches an Authorization: Bearer <CRON_SECRET> header
 * so the endpoint is not callable by anyone without that secret.
 *
 * Can also be triggered manually for testing:
 *   curl -X GET https://<domain>/api/cron/weekly-refresh \
 *        -H "Authorization: Bearer <CRON_SECRET>"
 */

import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { runWeeklyRefresh } from '@/lib/services/weeklyRefreshService';
import { getErrorMessage } from '@/lib/errorUtils';

// ---------------------------------------------------------------------------
// Anonymous user cleanup
// Every login creates a fresh anonymous Supabase auth user. This function
// removes any that haven't been active for > 90 days, keeping the auth table
// from growing unboundedly.
// ---------------------------------------------------------------------------
async function pruneStaleAnonymousUsers(client: SupabaseClient): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  let pruned = 0;
  let page = 1;

  for (;;) {
    const { data: { users }, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    if (!users.length) break;

    for (const u of users) {
      if (!u.is_anonymous) continue;
      const lastActive = u.last_sign_in_at
        ? new Date(u.last_sign_in_at)
        : new Date(u.created_at ?? 0);
      if (lastActive < cutoff) {
        const { error: delErr } = await client.auth.admin.deleteUser(u.id);
        if (!delErr) pruned++;
      }
    }

    if (users.length < 100) break;
    page++;
  }

  return pruned;
}

export async function GET(request: NextRequest) {
  // ------------------------------------------------------------------
  // Auth: only accept calls with the Vercel-injected CRON_SECRET
  // ------------------------------------------------------------------
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[cron/weekly-refresh] SUPABASE_SERVICE_ROLE_KEY is not set');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  // ------------------------------------------------------------------
  // Run the refresh (userId = null → auto)
  // ------------------------------------------------------------------
  try {
    const result = await runWeeklyRefresh(supabaseAdmin, null);
    console.log(
      `[cron/weekly-refresh] OK — created=${result.created} skipped=${result.skipped} deleted=${result.deleted} logsPruned=${result.logsPruned}`
    );

    // Best-effort: prune anonymous auth users inactive for > 90 days.
    let usersPruned = 0;
    try {
      usersPruned = await pruneStaleAnonymousUsers(supabaseAdmin);
      if (usersPruned > 0) console.log(`[cron/weekly-refresh] pruned ${usersPruned} stale anonymous users`);
    } catch (pruneErr) {
      console.error('[cron/weekly-refresh] anonymous user prune failed:', pruneErr);
    }

    return NextResponse.json({ success: true, ...result, usersPruned });
  } catch (err) {
    const message = getErrorMessage(err, 'Weekly refresh failed');
    console.error('[cron/weekly-refresh] FAILED —', message);
    // runWeeklyRefresh already writes the error to weekly_refresh_log
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
