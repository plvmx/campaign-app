/**
 * Public, unauthenticated data source for the "Final AFJ Campaign Lists"
 * page (/public/final-campaign-lists). Same fortnight, same all-states data
 * as /api/public/temporary-upcoming-campaigns — the query itself lives in
 * lib/services/publicCampaignListService.ts and is shared between the two
 * routes. This page is the "final" read-only list (Download only, no Edit),
 * shown once leaders have finished making changes on the temporary list.
 */
import { NextRequest, NextResponse } from 'next/server';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { fetchFortnightCampaignDays, getUpcomingFortnightDateStrings } from '@/lib/services/publicCampaignListService';
import type { PublicSlideDay } from '@/lib/slideGenerator';

const rateLimiter = createRateLimiter({ windowMs: 60 * 1000, maxAttempts: 30 });

export interface FinalCampaignListsResponse {
  days: PublicSlideDay[];
}

// Short-lived in-memory cache — one entry, since the response is identical
// for every caller (all states, current fortnight).
const CACHE_TTL_MS = 60 * 1000;
let cache: { key: string; expiresAt: number; response: FinalCampaignListsResponse } | null = null;

export async function GET(request: NextRequest) {
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

    const dateStrings = getUpcomingFortnightDateStrings();
    const cacheKey = dateStrings[0];

    if (cache && cache.key === cacheKey && cache.expiresAt > Date.now()) {
      return NextResponse.json(cache.response);
    }

    const days = await fetchFortnightCampaignDays(dateStrings);
    const response: FinalCampaignListsResponse = { days };
    cache = { key: cacheKey, expiresAt: Date.now() + CACHE_TTL_MS, response };

    return NextResponse.json(response);
  } catch (err) {
    console.error('public final-campaign-lists API exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
