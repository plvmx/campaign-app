/**
 * GET → { results: MyCampaignResultRow[] } — the signed-in leader's own campaign
 * results (date, location and the four tallies), newest first. Scoped on the
 * server to the caller's own state + leader name; nothing is taken from the
 * request. See lib/services/myCampaignResultsService.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createRateLimiter } from '@/lib/rateLimit';
import { authorizeLeaderRequest } from '@/lib/leaderRouteGuard';
import { getMyCampaignResults } from '@/lib/services/myCampaignResultsService';

const readLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxAttempts: 60 });

export async function GET(request: NextRequest) {
  const auth = await authorizeLeaderRequest(request, 'leader/my-campaign-results');
  if (!auth.ok) return auth.response;
  if (readLimiter.isLimited(auth.userId)) {
    return NextResponse.json({ error: 'Too many requests. Please wait a few minutes.' }, { status: 429 });
  }

  const { state, leader } = auth.caller;
  if (!state || !leader) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    return NextResponse.json({ results: await getMyCampaignResults(supabaseAdmin, { state, leader }) });
  } catch (err) {
    console.error('[leader/my-campaign-results] load failed:', err);
    return NextResponse.json({ error: 'Your results could not be loaded.' }, { status: 502 });
  }
}
