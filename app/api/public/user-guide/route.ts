/**
 * A short-lived link to the current CAS User Guide PDF, for the OPEN GUIDE
 * buttons — see lib/services/userGuideService.ts. Public (no sign-in) because
 * the guide is also offered on the sign-in screen for new leaders: Peter's
 * call (2026-10-15) that anyone may read it.
 *
 * Not in-memory cached like other /api/public GETs: right after an admin
 * uploads a new guide, a cached link would keep showing the old one.
 *
 * GET. Response: { url: string, uploadedAt: string } | { url: null } (none uploaded yet)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { getUserGuideView } from '@/lib/services/userGuideService';

const rateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 60 });

export async function GET(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  if (rateLimiter.isLimited(getClientIp(request))) {
    return NextResponse.json({ error: 'Too many requests. Please wait a few minutes and try again.' }, { status: 429 });
  }

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[public/user-guide] SUPABASE_SERVICE_ROLE_KEY is not set');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const view = await getUserGuideView(supabaseAdmin);
    return NextResponse.json(view ?? { url: null });
  } catch (err) {
    console.error('[public/user-guide] exception:', err);
    return NextResponse.json({ error: 'The guide could not be loaded. Please try again.' }, { status: 500 });
  }
}
