/**
 * Public, unauthenticated "Campaigns Near Me" screen for a registry
 * registrant reached via a personalized link in their WhatsApp-invite
 * email (lib/registryPipeline/whatsappInvite.ts) — see
 * app/public/campaigns-near-me/page.tsx.
 *
 * GET  — map data for one registrant, identified by `?r=<registry.registrants.id>`
 *        (never their raw name/email/mobile/postcode in the URL — those
 *        stay server-side, looked up by this opaque id, the same pattern
 *        /public/training/[campaignId] uses for a campaign id). Centres
 *        the map on their postcode (falling back to a state-level centre
 *        if no postcode is on file — postcode is only populated for
 *        registrations from ~2026-08-26 onward), for the 7 days starting
 *        today, within RADIUS_KM. Coordinates are cached state_places
 *        values only — no on-demand geocoding of a place, which needs the
 *        admin-only /api/admin/geocode-place route an anonymous visitor
 *        can't call; an unresolved place is simply omitted, same as the
 *        admin map's own established behaviour for one it can't place.
 * POST — records interest in one campaign for that same registrant,
 *        without asking them to re-type their name/mobile/email (unlike
 *        the general-public /api/public/register-interest, which has no
 *        identity to look those up from) — re-derived server-side from
 *        the registrant id every time, so the write can't be tampered
 *        with via the request body.
 *
 * Not in-memory cached like the other /api/public/* GETs — each request
 * is personalized to one registrant, not identical for every caller, same
 * reasoning as /public/training/[campaignId]'s GET.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { formatDateForDb } from '@/lib/campaignDates';
import { isCampaignPast } from '@/lib/campaignUtils';
import { normalizeMobile } from '@/lib/auth';
import { geocodeAddress } from '@/lib/geocoding';
import {
  buildNearbyMarkers,
  type CampaignsNearMeResponse,
  type PublicNearbyCampaignRow,
  type PublicPlaceCoords,
} from '@/lib/services/publicCampaignsNearMeService';

const RADIUS_KM = 60; // Same default as the admin "Campaigns Near Me" map.
const WINDOW_DAYS = 7; // Today + the next 6 days, per Peter's request.

const getRateLimiter = createRateLimiter({ windowMs: 60 * 1000, maxAttempts: 30 });
const postRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 10 });

interface RegistrantLocation {
  first_name: string | null;
  email: string | null;
  phone: string | null;
  state: string | null;
  postcode: string | null;
}

async function getRegistrant(id: string): Promise<RegistrantLocation | null> {
  const { data, error } = await supabaseAdmin
    .schema('registry')
    .from('registrants')
    .select('first_name, email, phone, state, postcode')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as RegistrantLocation | null) ?? null;
}

export async function GET(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  const ip = getClientIp(request);
  if (getRateLimiter.isLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const registrantId = request.nextUrl.searchParams.get('r');
  if (!registrantId) {
    return NextResponse.json({ error: 'Missing registrant id' }, { status: 400 });
  }

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[public/campaigns-near-me] SUPABASE_SERVICE_ROLE_KEY is not set');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const registrant = await getRegistrant(registrantId);
    if (!registrant) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + WINDOW_DAYS - 1);
    const startDateStr = formatDateForDb(today);
    const endDateStr = formatDateForDb(endDate);

    // No postcode on file (common for anyone registered before ~2026-08-26)
    // falls back to a state-level centre — coarser, but still useful;
    // neither postcode nor state means there's nothing to centre a map on.
    const noLocationResponse = () => {
      const body: CampaignsNearMeResponse = {
        firstName: registrant.first_name,
        startDate: startDateStr,
        endDate: endDateStr,
        radiusKm: RADIUS_KM,
        center: null,
        markers: [],
        unresolvedCount: 0,
      };
      return NextResponse.json(body);
    };

    const geocodeQuery = registrant.postcode
      ? `${registrant.postcode} ${registrant.state ?? ''}, Australia`
      : registrant.state
        ? `${registrant.state}, Australia`
        : null;
    if (!geocodeQuery) {
      return noLocationResponse();
    }

    const geocoded = await geocodeAddress(geocodeQuery);
    if (!geocoded) {
      return noLocationResponse();
    }

    const [{ data: campaignRows, error: campaignError }, { data: placeRows, error: placeError }] = await Promise.all([
      supabaseAdmin
        .from('campaigns')
        .select('id, date, state, place, time, leader, category')
        .gte('date', startDateStr)
        .lte('date', endDateStr)
        .order('date', { ascending: true })
        .order('time', { ascending: true }),
      supabaseAdmin
        .from('state_places')
        .select('state, place, latitude, longitude')
        .not('latitude', 'is', null)
        .not('longitude', 'is', null),
    ]);
    if (campaignError) throw campaignError;
    if (placeError) throw placeError;

    const upcoming = ((campaignRows ?? []) as PublicNearbyCampaignRow[]).filter((c) => !isCampaignPast(c.date, c.time));
    const placeCoords = (placeRows ?? []) as PublicPlaceCoords[];

    const { markers, unresolvedCount } = buildNearbyMarkers(
      upcoming,
      placeCoords,
      { latitude: geocoded.latitude, longitude: geocoded.longitude },
      RADIUS_KM,
    );

    const body: CampaignsNearMeResponse = {
      firstName: registrant.first_name,
      startDate: startDateStr,
      endDate: endDateStr,
      radiusKm: RADIUS_KM,
      center: { latitude: geocoded.latitude, longitude: geocoded.longitude, label: geocoded.displayName },
      markers,
      unresolvedCount,
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error('[public/campaigns-near-me] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  const ip = getClientIp(request);
  if (postRateLimiter.isLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[public/campaigns-near-me] SUPABASE_SERVICE_ROLE_KEY is not set');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const body: unknown = await request.json();
    const bodyObj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const registrantId = typeof bodyObj.registrantId === 'string' ? bodyObj.registrantId : '';
    const campaignId = typeof bodyObj.campaignId === 'string' ? bodyObj.campaignId : '';
    const interestType = bodyObj.interestType;

    if (!registrantId || !campaignId) {
      return NextResponse.json({ error: 'Missing registrant or campaign id' }, { status: 400 });
    }
    if (interestType !== 'in' && interestType !== 'more') {
      return NextResponse.json({ error: 'Invalid interest type' }, { status: 400 });
    }

    const registrant = await getRegistrant(registrantId);
    if (!registrant) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Same requirement campaign_interest's own CHECK constraint enforces
    // (campaign_interest_contact_required) — checked here too so this
    // returns a clear error instead of a raw DB constraint failure.
    if (!registrant.email && !registrant.phone) {
      return NextResponse.json({ error: 'No contact details on file for this registration' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('campaign_interest').insert({
      campaign_id: campaignId,
      // Falls back to a placeholder rather than failing outright — first_name
      // is NOT NULL on campaign_interest, and while every registrant should
      // have one (mapAcFields always attempts to capture it), a national
      // admin could have cleared it via /registry/manage's Edit mode.
      first_name: registrant.first_name?.trim() || 'AFJ Registrant',
      // registry.registrants.phone is E.164 ('+61...'); campaign_interest's
      // other rows are in the local '0XXXXXXXXX' format the rest of the app
      // uses (whatever a visitor typed into the public form) — normalized
      // here so this table doesn't end up with two different formats.
      mobile: registrant.phone ? normalizeMobile(registrant.phone) : null,
      email: registrant.email,
      interest_type: interestType,
    });
    if (error) {
      console.error('[public/campaigns-near-me] POST insert error:', error);
      return NextResponse.json({ error: 'Failed to register your interest' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[public/campaigns-near-me] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
