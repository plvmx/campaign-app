/**
 * Public, unauthenticated data source for the Week 1 Campaigns list
 * (/public/week1-campaigns). Mirrors the "All States" path of
 * generateAndDownloadAriseList (lib/ariseGenerator.ts) but:
 *  - runs server-side with the service role, since anonymous visitors have
 *    no RLS access to `campaigns`
 *  - selects the same public-safe columns the authenticated generator
 *    already used (no mobile numbers, no admin-only fields)
 *  - fetches the whole 8-day window in one ranged query instead of 8
 *    sequential per-day queries, since this route is open to anyone with
 *    the link rather than gated behind an admin click
 *  - caches the result briefly, since every caller gets the same "all
 *    states, current window" data
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { calculateCampaignDates, formatDateForDb } from '@/lib/campaignDates';
import { getAriseDateRange, type AriseCampaign } from '@/lib/ariseLayout';

// Generous limit — this is a read-only, public-safe endpoint; the rate limit
// exists to blunt scripted hammering, not to gate legitimate sharing.
const rateLimiter = createRateLimiter({ windowMs: 60 * 1000, maxAttempts: 30 });

export interface Week1CampaignsDay {
  date: string; // YYYY-MM-DD
  campaigns: AriseCampaign[];
}

export interface Week1CampaignsResponse {
  days: Week1CampaignsDay[];
}

// ---------------------------------------------------------------------------
// Short-lived in-memory cache — one entry, since the response is identical
// for every caller (all states, current window). Avoids hitting Postgres on
// every open of a link that may get shared and opened many times in a burst.
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 60 * 1000;
let cache: { key: string; expiresAt: number; response: Week1CampaignsResponse } | null = null;

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
    const dates = getAriseDateRange(upcomingCampaignStart);
    const dateStrings = dates.map(formatDateForDb);
    const cacheKey = dateStrings[0];

    if (cache && cache.key === cacheKey && cache.expiresAt > Date.now()) {
      return NextResponse.json(cache.response);
    }

    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .select('id, date, state, place, site, time, leader, category')
      .gte('date', dateStrings[0])
      .lte('date', dateStrings[dateStrings.length - 1])
      .order('state', { ascending: true })
      .order('place', { ascending: true })
      .order('time', { ascending: true });

    if (error) {
      console.error('public week1-campaigns API error:', error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const campaigns = (data ?? []) as AriseCampaign[];
    const days: Week1CampaignsDay[] = dateStrings.map((date) => ({
      date,
      campaigns: campaigns.filter((c) => c.date === date),
    }));

    const response: Week1CampaignsResponse = { days };
    cache = { key: cacheKey, expiresAt: Date.now() + CACHE_TTL_MS, response };

    return NextResponse.json(response);
  } catch (err) {
    console.error('public week1-campaigns API exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
