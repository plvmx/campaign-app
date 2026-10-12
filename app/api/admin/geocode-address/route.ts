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
import { enforceOrigin } from '@/lib/corsUtils';
import { verifyAdminCaller } from '@/lib/services/adminCallerService';
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

  // Full admin (AD) signed in with 2FA — shared check, see lib/services/adminCallerService.ts.
  const caller = await verifyAdminCaller(supabaseAdmin, token);
  if (!caller.ok) {
    return NextResponse.json({ error: caller.error }, { status: caller.status });
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
