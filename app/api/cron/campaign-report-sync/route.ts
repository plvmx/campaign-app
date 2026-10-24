/**
 * Vercel Cron — Campaign Report sheet sync (temporary)
 *
 * Pulls new rows from the live Google Sheet into `campaign_reports` until the
 * app's own campaign-report numbers replace the sheet. Schedule is in
 * vercel.json. Same CRON_SECRET bearer check as /api/cron/weekly-refresh:
 *   curl https://<domain>/api/cron/campaign-report-sync -H "Authorization: Bearer <CRON_SECRET>"
 *
 * Needs CAMPAIGN_REPORT_SHEET_ID (the id between /d/ and /edit in the sheet's URL).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { syncCampaignReportsFromSheet } from '@/lib/services/campaignReportSyncService';
import { getErrorMessage } from '@/lib/errorUtils';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sheetId = process.env.CAMPAIGN_REPORT_SHEET_ID;
  if (!sheetId || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[cron/campaign-report-sync] CAMPAIGN_REPORT_SHEET_ID or SUPABASE_SERVICE_ROLE_KEY is not set');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  try {
    const result = await syncCampaignReportsFromSheet(supabaseAdmin, sheetId);
    console.log(`[cron/campaign-report-sync] OK — ${JSON.stringify(result)}`);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = getErrorMessage(err, 'Campaign report sync failed');
    console.error('[cron/campaign-report-sync] FAILED —', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
