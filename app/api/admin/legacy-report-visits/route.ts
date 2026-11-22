/**
 * Admin-only: how many leaders are still arriving from the old campaign
 * results report (visits to /public/campaign-reporting-moved).
 * GET. Authorization: Bearer <supabase_access_token>; full admin (AD) at 2FA.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { verifyAdminCaller } from '@/lib/services/adminCallerService';
import { getLegacyReportVisitSummary } from '@/lib/services/legacyReportVisitService';

export async function GET(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('SUPABASE_SERVICE_ROLE_KEY is not set');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const caller = await verifyAdminCaller(supabaseAdmin, token);
    if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

    return NextResponse.json(await getLegacyReportVisitSummary(supabaseAdmin));
  } catch (err) {
    console.error('[admin/legacy-report-visits] exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
