/**
 * Counts one visit to /public/campaign-reporting-moved (leaders redirected from
 * the old campaign results report). Public — anonymous visitors have no RLS
 * access to legacy_report_visits, so this writes with the service role.
 * Stores only a random device id from the page, never a name or number.
 *
 * POST { deviceId?: string }. Response: { ok: true }
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { recordLegacyReportVisit } from '@/lib/services/legacyReportVisitService';

const rateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 30 });

export async function POST(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  if (rateLimiter.isLimited(getClientIp(request))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[public/legacy-report-visit] SUPABASE_SERVICE_ROLE_KEY is not set');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    const body = await request.json().catch(() => ({}));
    await recordLegacyReportVisit(supabaseAdmin, (body as { deviceId?: unknown }).deviceId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[public/legacy-report-visit] exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
