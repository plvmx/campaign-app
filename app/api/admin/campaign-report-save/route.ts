/**
 * Admin-only: save a TWOL Campaign Report from the experimental page — the
 * counts to `campaign_reports`, the names to `results`, both tagged
 * `source = 'app_report_experimental'` (see
 * lib/services/campaignReportSaveService.ts). Caller must be a full admin (AD)
 * signed in with 2FA (lib/adminRouteGuard.ts).
 * POST body: { campaignId, partial, full, sinnersPrayers, followUp, names: { partial: string[], full: string[], sinnersPrayers: string[], followUp: string[] } }
 * Responds { status: 'saved', names: number }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createRateLimiter } from '@/lib/rateLimit';
import { authorizeAdminRequest } from '@/lib/adminRouteGuard';
import { parseReportSubmission, saveCampaignReport } from '@/lib/services/campaignReportSaveService';

const rateLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxAttempts: 20 });

export async function POST(request: NextRequest) {
  const auth = await authorizeAdminRequest(request, 'admin/campaign-report-save');
  if (!auth.ok) return auth.response;

  if (rateLimiter.isLimited(auth.userId)) {
    return NextResponse.json({ error: 'Too many requests. Please wait a few minutes.' }, { status: 429 });
  }

  const submission = parseReportSubmission(await request.json().catch(() => null));
  if (!submission) {
    return NextResponse.json(
      { error: 'A campaign, a number from 0 to 99 for each count, and one valid name for every counted person are required.' },
      { status: 400 },
    );
  }

  try {
    const result = await saveCampaignReport(supabaseAdmin, { ...submission, actorUserId: auth.userId });
    if (result.status === 'campaign_not_found') {
      return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error('[admin/campaign-report-save] save failed:', err);
    return NextResponse.json({ error: 'The report could not be saved.' }, { status: 502 });
  }
}
