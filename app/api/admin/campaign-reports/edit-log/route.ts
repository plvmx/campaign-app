/**
 * Audit trail of hand edits made on /admin/campaign-reports, newest first, 50 per page.
 * GET ?page=1 -> { entries, page, pageSize, total }
 * Authorization: Bearer <supabase_access_token>  (caller must be a full admin with 2FA)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { authorizeAdminRequest } from '@/lib/adminRouteGuard';
import { getEditLog } from '@/lib/services/campaignReportManageService';
import { getErrorMessage } from '@/lib/errorUtils';

const LOG_TAG = 'admin/campaign-reports/edit-log';

export async function GET(request: NextRequest) {
  const auth = await authorizeAdminRequest(request, LOG_TAG);
  if (!auth.ok) return auth.response;
  try {
    const page = Number(request.nextUrl.searchParams.get('page') ?? '1');
    return NextResponse.json(await getEditLog(supabaseAdmin, page));
  } catch (err) {
    console.error(`[${LOG_TAG}] failed:`, err);
    return NextResponse.json({ error: getErrorMessage(err, 'Failed to load the edit log') }, { status: 500 });
  }
}
