/**
 * Public, unauthenticated data source for the "Upcoming Campaigns" map
 * (/public/upcoming-campaigns) — the general-public counterpart to the
 * admin-only /admin/campaign-map this replaced. `?startDate=&endDate=`
 * (both required, yyyy-mm-dd) select the week; the page's own This
 * Week/Next Week toggle supplies these. Anonymous visitors have no RLS
 * access to `campaigns`, so this uses the service role like every other
 * /api/public/* route. Coordinates are cached state_places values only —
 * no on-demand geocoding, which needs the admin-only geocode-place route
 * (see lib/services/publicUpcomingCampaignsService.ts's own comment).
 *
 * Cached in-memory per date-range key (short TTL) since the response is
 * identical for every caller asking about the same week, same pattern as
 * /api/public/final-campaign-lists.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { isCampaignPast } from '@/lib/campaignUtils';
import type { AriseCampaign } from '@/lib/ariseLayout';
import {
  buildUpcomingCampaignMarkers,
  type PublicUpcomingPlaceCoords,
  type PublicUpcomingMarker,
} from '@/lib/services/publicUpcomingCampaignsService';

const rateLimiter = createRateLimiter({ windowMs: 60 * 1000, maxAttempts: 30 });

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface UpcomingCampaignsResponse {
  markers: PublicUpcomingMarker[];
  unresolvedCount: number;
  /**
   * The same upcoming campaigns the markers are built from, as a flat,
   * pre-sorted list — powers the "List View" toggle on
   * /public/upcoming-campaigns (CampaignCheckboxList, the same component
   * /public/register-interest uses), so a visitor who'd rather not use the
   * map sees an equivalent checklist for the exact same date range.
   */
  campaigns: AriseCampaign[];
}

// Short-lived in-memory cache — the response is identical for every caller
// asking about the same date range (all states).
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, { expiresAt: number; response: UpcomingCampaignsResponse }>();

export async function GET(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  const ip = getClientIp(request);
  if (rateLimiter.isLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const startDate = request.nextUrl.searchParams.get('startDate') ?? '';
  const endDate = request.nextUrl.searchParams.get('endDate') ?? '';
  if (!DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate)) {
    return NextResponse.json({ error: 'Invalid or missing startDate/endDate' }, { status: 400 });
  }

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[public/upcoming-campaigns] SUPABASE_SERVICE_ROLE_KEY is not set');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const cacheKey = `${startDate}:${endDate}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.response);
    }

    const [{ data: campaignRows, error: campaignError }, { data: placeRows, error: placeError }] = await Promise.all([
      supabaseAdmin
        .from('campaigns')
        .select('id, date, state, place, site, time, leader, category')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true })
        .order('state', { ascending: true })
        .order('place', { ascending: true })
        .order('time', { ascending: true }),
      supabaseAdmin
        .from('state_places')
        .select('state, place, latitude, longitude')
        .not('latitude', 'is', null)
        .not('longitude', 'is', null),
    ]);
    if (campaignError) throw campaignError;
    if (placeError) throw placeError;

    // Typed as AriseCampaign (carries `site`, unlike PublicUpcomingCampaignRow)
    // since this same filtered list also becomes the response's flat
    // `campaigns` field for the List View toggle — it structurally
    // satisfies PublicUpcomingCampaignRow[] for marker-building below too.
    const upcoming = ((campaignRows ?? []) as AriseCampaign[]).filter((c) => !isCampaignPast(c.date, c.time));
    const placeCoords = (placeRows ?? []) as PublicUpcomingPlaceCoords[];

    const { markers, unresolvedCount } = buildUpcomingCampaignMarkers(upcoming, placeCoords);

    const response: UpcomingCampaignsResponse = { markers, unresolvedCount, campaigns: upcoming };
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, response });

    return NextResponse.json(response);
  } catch (err) {
    console.error('[public/upcoming-campaigns] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
