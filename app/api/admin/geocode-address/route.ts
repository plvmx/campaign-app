/**
 * Server-side address geocoding for the "Campaigns Near Me" map.
 * POST body: { address: string }
 * Authorization: Bearer <supabase_access_token>
 *
 * Resolves a free-form Australian address to coordinates via Nominatim
 * (server-side, so a proper User-Agent can be set per Nominatim's usage policy).
 * Unlike /api/admin/geocode-place, results are NOT cached — addresses are
 * one-off lookups for the centre of the map and don't correspond to a row in
 * state_places.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { normalizeName } from '@/lib/auth';
import { enforceOrigin } from '@/lib/corsUtils';
import { geocodeAddress } from '@/lib/geocoding';

export async function POST(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[admin/geocode-address] SUPABASE_SERVICE_ROLE_KEY is not set');
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

  let body: { address?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const address = typeof body.address === 'string' ? body.address.trim() : null;
  if (!address) {
    return NextResponse.json({ error: 'Missing address' }, { status: 400 });
  }

  const result = await geocodeAddress(address);
  if (!result) {
    return NextResponse.json({ error: 'No coordinates found for this address' }, { status: 404 });
  }

  return NextResponse.json({
    latitude: result.latitude,
    longitude: result.longitude,
    displayName: result.displayName,
  });
}
