/**
 * Admin-only: email a submitted TWOL Campaign Report to management — see
 * lib/services/campaignReportEmailService.ts. Caller must be a full admin (AD)
 * signed in with 2FA (lib/adminRouteGuard.ts).
 * POST body: { campaignId: string, partial: number, full: number, sinnersPrayers: number, followUp: number }
 * Responds { status: 'sent' | 'disabled' | 'no_recipients' }; 502 if sending failed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createRateLimiter } from '@/lib/rateLimit';
import { authorizeAdminRequest } from '@/lib/adminRouteGuard';
import { parseReportCounts, sendCampaignReportEmail } from '@/lib/services/campaignReportEmailService';

// Per signed-in admin, so a stuck button or script can't flood management's inbox.
const rateLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxAttempts: 10 });

export async function POST(request: NextRequest) {
  const auth = await authorizeAdminRequest(request, 'admin/campaign-report-email');
  if (!auth.ok) return auth.response;

  if (rateLimiter.isLimited(auth.userId)) {
    return NextResponse.json({ error: 'Too many requests. Please wait a few minutes.' }, { status: 429 });
  }

  const body: unknown = await request.json().catch(() => null);
  const campaignId = body && typeof body === 'object' && typeof (body as { campaignId?: unknown }).campaignId === 'string'
    ? (body as { campaignId: string }).campaignId
    : '';
  const counts = parseReportCounts(body);
  if (!campaignId || !counts) {
    return NextResponse.json({ error: 'A campaign and a number from 0 to 99 for each count are required.' }, { status: 400 });
  }

  try {
    const result = await sendCampaignReportEmail(supabaseAdmin, { campaignId, counts });
    if (result.status === 'campaign_not_found') {
      return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
    }
    return NextResponse.json({ status: result.status });
  } catch (err) {
    console.error('[admin/campaign-report-email] send failed:', err);
    return NextResponse.json({ error: 'The report could not be emailed.' }, { status: 502 });
  }
}
