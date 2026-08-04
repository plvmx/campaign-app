/**
 * Server-side geocoding for the admin campaign map.
 * POST body: { state: string, place: string }
 * Authorization: Bearer <supabase_access_token>
 *
 * Looks up cached coordinates on state_places first; if missing, geocodes via
 * Nominatim (server-side, so a proper User-Agent can be set per their usage policy)
 * using the matching state_places row's `location` field — the sole source for
 * coordinates, since `place` is often a venue/event name rather than a real
 * suburb/town — and persists the result so future lookups for the same place are free.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { normalizeName } from '@/lib/auth';
import { enforceOrigin } from '@/lib/corsUtils';
import { geocodePlace } from '@/lib/geocoding';

// A few rows are administratively grouped under one state (`state_places.state`, which
// drives who manages them / which campaign group they belong to) but are physically
// located in another — geocoding with the row's own state then finds no match. Override
// the state used in the *geocode query only* for these; the stored `state` column and
// campaign grouping are untouched. Keep in sync with the same map in
// scripts/backfill_state_places_coords.js.
const GEOCODE_STATE_OVERRIDES: Record<string, string> = {
  'f9811c68-0c9a-45e2-890a-e94fdcf0331c': 'NSW', // ACT :: Jervis Bay — physically on the NSW south coast
  '4dd81bed-5b01-433b-91b6-629cbece75f9': 'NSW', // ACT :: Sanctuary Point — physically on the NSW south coast
};

export async function POST(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[admin/geocode-place] SUPABASE_SERVICE_ROLE_KEY is not set');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('name, state')
    .eq('user_id', user.id)
    .single();

  if (!profile?.name || !profile?.state) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const normalizedState = profile.state.toUpperCase().trim();
  const normalizedName  = normalizeName(profile.name);

  const { data: leaderRows } = await supabaseAdmin
    .from('state_leaders')
    .select('admin')
    .eq('state', normalizedState)
    .ilike('leader', normalizedName)
    .limit(1);

  const adminStatus = leaderRows?.[0]?.admin ?? null;
  if (adminStatus !== 'AD') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { state?: unknown; place?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const state = typeof body.state === 'string' ? body.state.trim().toUpperCase() : null;
  const place = typeof body.place === 'string' ? body.place.trim() : null;
  if (!state || !place) {
    return NextResponse.json({ error: 'Missing state or place' }, { status: 400 });
  }

  // `place` is matched loosely (trim + collapsed whitespace + case-insensitive) because
  // campaigns.place and state_places.place are independently free-typed and can differ by
  // incidental whitespace (e.g. "Preston" vs "Preston "), which would otherwise silently
  // break the coordinate cache.
  const { data: statePlaces } = await supabaseAdmin
    .from('state_places')
    .select('id, place, location, latitude, longitude')
    .eq('state', state);

  const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const existing = statePlaces?.find(p => normalize(p.place) === normalize(place)) ?? null;

  if (existing?.latitude != null && existing?.longitude != null) {
    return NextResponse.json({ latitude: existing.latitude, longitude: existing.longitude, cached: true });
  }

  if (!existing?.location) {
    return NextResponse.json({ error: 'No location set for this place' }, { status: 404 });
  }

  const geocodeState = (existing.id && GEOCODE_STATE_OVERRIDES[existing.id]) || state;
  const geocoded = await geocodePlace(existing.location, geocodeState);
  if (!geocoded) {
    return NextResponse.json({ error: 'No coordinates found for this location' }, { status: 404 });
  }

  if (existing?.id) {
    await supabaseAdmin
      .from('state_places')
      .update({ latitude: geocoded.latitude, longitude: geocoded.longitude })
      .eq('id', existing.id);
  }

  return NextResponse.json({ latitude: geocoded.latitude, longitude: geocoded.longitude, cached: false });
}
