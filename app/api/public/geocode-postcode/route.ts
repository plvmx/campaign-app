/**
 * Public, unauthenticated postcode lookup for the "Upcoming Campaigns" map's
 * "Show me Campaigns Near Me" field (/public/upcoming-campaigns). Unlike
 * the admin campaign map's browser-geolocation "Near Me" button, a public
 * visitor types their own postcode instead — this just geocodes it and
 * hands back coordinates for the page to recentre its existing marker set
 * on (no radius re-filtering, same as the admin map's own "Near Me" —
 * see app/public/upcoming-campaigns/UpcomingCampaignsClient.tsx).
 */
import { NextRequest, NextResponse } from 'next/server';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { geocodeAddress } from '@/lib/geocoding';

const rateLimiter = createRateLimiter({ windowMs: 60 * 1000, maxAttempts: 20 });

const POSTCODE_PATTERN = /^\d{4}$/;

export async function POST(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  const ip = getClientIp(request);
  if (rateLimiter.isLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const body: unknown = await request.json();
    const bodyObj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const postcode = typeof bodyObj.postcode === 'string' ? bodyObj.postcode.trim() : '';

    if (!POSTCODE_PATTERN.test(postcode)) {
      return NextResponse.json({ error: 'Please enter a valid 4-digit postcode' }, { status: 400 });
    }

    const geocoded = await geocodeAddress(`${postcode}, Australia`);
    if (!geocoded) {
      return NextResponse.json({ error: `No location found for postcode ${postcode}` }, { status: 404 });
    }

    return NextResponse.json({
      latitude: geocoded.latitude,
      longitude: geocoded.longitude,
      displayName: geocoded.displayName,
    });
  } catch (err) {
    console.error('[public/geocode-postcode] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
