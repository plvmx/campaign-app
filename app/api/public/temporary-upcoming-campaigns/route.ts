/**
 * Public, unauthenticated data source for the "Temporary Upcoming Campaigns"
 * page (/public/temporary-upcoming-campaigns). Same shape of route as
 * /api/public/week1-campaigns, but:
 *  - covers the full fortnight (14 days), matching the authenticated
 *    Register Interest screen and the "Leader Campaign Lists" download
 *  - also returns each day's campaign_messages banner text, since the
 *    response doubles as the input to generateAndDownloadSlidesFromData
 *    (lib/slideGenerator.ts) for the page's Download button — one fetch
 *    powers both the on-screen list and the ZIP
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { calculateCampaignDates, formatDateForDb, getFortnightDateRange } from '@/lib/campaignDates';
import type { SlideCampaign, PublicSlideDay } from '@/lib/slideGenerator';

const rateLimiter = createRateLimiter({ windowMs: 60 * 1000, maxAttempts: 30 });

export interface TemporaryUpcomingCampaignsResponse {
  days: PublicSlideDay[];
}

// Short-lived in-memory cache — one entry, since the response is identical
// for every caller (all states, current fortnight).
const CACHE_TTL_MS = 60 * 1000;
let cache: { key: string; expiresAt: number; response: TemporaryUpcomingCampaignsResponse } | null = null;

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

    const { upcomingCampaignStart } = calculateCampaignDates();
    const dates = getFortnightDateRange(upcomingCampaignStart);
    const dateStrings = dates.map(formatDateForDb);
    const cacheKey = dateStrings[0];

    if (cache && cache.key === cacheKey && cache.expiresAt > Date.now()) {
      return NextResponse.json(cache.response);
    }

    const [campaignsResult, messagesResult] = await Promise.all([
      supabaseAdmin
        .from('campaigns')
        .select('id, date, state, place, site, time, leader, category')
        .gte('date', dateStrings[0])
        .lte('date', dateStrings[dateStrings.length - 1])
        .order('date', { ascending: true })
        .order('state', { ascending: true })
        .order('place', { ascending: true })
        .order('time', { ascending: true }),
      supabaseAdmin
        .from('campaign_messages')
        .select('date, message')
        .gte('date', dateStrings[0])
        .lte('date', dateStrings[dateStrings.length - 1]),
    ]);

    if (campaignsResult.error) {
      console.error('public temporary-upcoming-campaigns API error (campaigns):', campaignsResult.error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    if (messagesResult.error) {
      console.error('public temporary-upcoming-campaigns API error (messages):', messagesResult.error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const campaigns = campaignsResult.data ?? [];
    const messageByDate = new Map<string, string>(
      (messagesResult.data ?? []).map((m: { date: string; message: string }) => [m.date, m.message]),
    );

    const days: PublicSlideDay[] = dateStrings.map((date) => ({
      date,
      // mobile is never selected above — hard-coded null here so this can
      // never accidentally carry a phone number to an anonymous caller.
      campaigns: campaigns
        .filter((c) => c.date === date)
        .map((c): SlideCampaign => ({ ...c, mobile: null })),
      message: messageByDate.get(date) ?? null,
    }));

    const response: TemporaryUpcomingCampaignsResponse = { days };
    cache = { key: cacheKey, expiresAt: Date.now() + CACHE_TTL_MS, response };

    return NextResponse.json(response);
  } catch (err) {
    console.error('public temporary-upcoming-campaigns API exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
