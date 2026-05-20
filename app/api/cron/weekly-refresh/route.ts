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
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { runWeeklyRefresh } from '@/lib/services/weeklyRefreshService';
import { getErrorMessage } from '@/lib/errorUtils';

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
      `[cron/weekly-refresh] OK — created=${result.created} skipped=${result.skipped} deleted=${result.deleted}`
    );
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = getErrorMessage(err, 'Weekly refresh failed');
    console.error('[cron/weekly-refresh] FAILED —', message);
    // runWeeklyRefresh already writes the error to weekly_refresh_log
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
