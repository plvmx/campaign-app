/**
 * Server-side geocoding for the admin campaign map.
 * POST body: { state: string, place: string }
 * Authorization: Bearer <supabase_access_token>
 *
 * Looks up cached coordinates on state_places first; if missing, geocodes via
 * Nominatim (server-side, so a proper User-Agent can be set per their usage policy)
 * and persists the result so future lookups for the same place are free.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { normalizeName } from '@/lib/auth';
import { enforceOrigin } from '@/lib/corsUtils';
import { geocodePlace } from '@/lib/geocoding';

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

  let body: { state?: unknown; place?: unknown; site?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const state = typeof body.state === 'string' ? body.state.trim().toUpperCase() : null;
  const place = typeof body.place === 'string' ? body.place.trim() : null;
  const site  = typeof body.site  === 'string' ? body.site.trim()  : '';
  if (!state || !place) {
    return NextResponse.json({ error: 'Missing state or place' }, { status: 400 });
  }

  // `place` is matched loosely (trim + collapsed whitespace + case-insensitive) because
  // campaigns.place and state_places.place are independently free-typed and can differ by
  // incidental whitespace (e.g. "Preston" vs "Preston "), which would otherwise silently
  // break the coordinate cache. `site` is a structured column, so it's compared exactly —
  // "Orange 1" and "Orange 2" are distinct sites with potentially distinct coordinates.
  const { data: statePlaces } = await supabaseAdmin
    .from('state_places')
    .select('id, place, site, latitude, longitude')
    .eq('state', state);

  const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const existing = statePlaces?.find(p => normalize(p.place) === normalize(place) && (p.site || '') === site) ?? null;

  if (existing?.latitude != null && existing?.longitude != null) {
    return NextResponse.json({ latitude: existing.latitude, longitude: existing.longitude, cached: true });
  }

  const geocoded = await geocodePlace(site ? `${place} ${site}` : place, state);
  if (!geocoded) {
    return NextResponse.json({ error: 'No coordinates found for this place' }, { status: 404 });
  }

  if (existing?.id) {
    await supabaseAdmin
      .from('state_places')
      .update({ latitude: geocoded.latitude, longitude: geocoded.longitude })
      .eq('id', existing.id);
  }

  return NextResponse.json({ latitude: geocoded.latitude, longitude: geocoded.longitude, cached: false });
}
