/**
 * Public, unauthenticated data source for the "Campaign Results" page
 * (/public/campaign-results). Mirrors the "All States" path of
 * fetchReportRows (lib/reportGenerator.ts) — the same pipeline behind
 * AdminQuickActions' "Campaign Results" button — but:
 *  - runs server-side with the service role, since anonymous visitors have
 *    no RLS access to `campaigns`/`results`
 *  - always covers the past campaign week, all states — no SR/admin
 *    state filtering, since there's no logged-in user to derive one from
 *  - caches the result briefly, since every caller gets the same "all
 *    states, current past week" data
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { calculateCampaignDates, formatDateForDb } from '@/lib/campaignDates';
import { fetchReportRows, type ReportRow } from '@/lib/reportGenerator';

// Generous limit — this is a read-only, public-safe endpoint; the rate limit
// exists to blunt scripted hammering, not to gate legitimate sharing.
const rateLimiter = createRateLimiter({ windowMs: 60 * 1000, maxAttempts: 30 });

export interface CampaignResultsResponse {
  rows: ReportRow[];
}

// ---------------------------------------------------------------------------
// Short-lived in-memory cache — one entry, since the response is identical
// for every caller (all states, current past week).
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 60 * 1000;
let cache: { key: string; expiresAt: number; response: CampaignResultsResponse } | null = null;

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

    const { pastCampaignStart } = calculateCampaignDates();
    const pastEnd = new Date(pastCampaignStart);
    pastEnd.setDate(pastEnd.getDate() + 6);
    const startDate = formatDateForDb(pastCampaignStart);
    const endDate = formatDateForDb(pastEnd);
    const cacheKey = startDate;

    if (cache && cache.key === cacheKey && cache.expiresAt > Date.now()) {
      return NextResponse.json(cache.response);
    }

    let rows: ReportRow[] = [];
    try {
      rows = await fetchReportRows({ supabase: supabaseAdmin, startDate, endDate });
    } catch (err) {
      // fetchReportRows throws a plain Error when there are no campaigns/no
      // recorded results in range — that's a normal "nothing to show yet"
      // state for a public link, not a server error. Anything else (a real
      // Postgrest error) is rethrown to the outer catch below.
      const msg = err instanceof Error ? err.message : '';
      if (!msg.includes('No campaigns found') && !msg.includes('No results recorded')) {
        throw err;
      }
    }

    const response: CampaignResultsResponse = { rows };
    cache = { key: cacheKey, expiresAt: Date.now() + CACHE_TTL_MS, response };

    return NextResponse.json(response);
  } catch (err) {
    console.error('public campaign-results API exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
