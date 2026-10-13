/**
 * Per-campaign counts of members who registered interest — numbers only (no
 * personal details), for any signed-in leader, for the campaigns that leader
 * can see. See lib/services/interestCountsService.ts for why this exists
 * (members' details need a 2FA-level session; the count does not).
 * POST body: { campaignIds: string[] }. Authorization: Bearer <access token>.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { getVisibleInterestCounts, MAX_CAMPAIGN_IDS } from '@/lib/services/interestCountsService';

const rateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 120 });

export async function POST(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  const ip = getClientIp(request);
  if (rateLimiter.isLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('SUPABASE_SERVICE_ROLE_KEY is not set');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

    const body = await request.json().catch(() => null);
    const ids: unknown = body?.campaignIds;
    if (!Array.isArray(ids) || ids.length > MAX_CAMPAIGN_IDS || !ids.every((i) => typeof i === 'string' && i.length <= 100)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    // A client carrying the caller's own JWT, so RLS decides which campaigns they can see.
    const userClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    return NextResponse.json(await getVisibleInterestCounts(userClient, supabaseAdmin, ids as string[]));
  } catch (err) {
    console.error('interest-counts API exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
