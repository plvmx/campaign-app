/**
 * Campaign Report locations (see lib/services/campaignReportLocationsService.ts
 * and the /admin/campaign-report-locations screen).
 *
 * GET  -> { locations, places }  sheet locations with no state_places place yet
 * POST -> { locationKey, state, place?, newPlace? }  record a mapping and apply it
 * Authorization: Bearer <supabase_access_token>  (caller must be a full admin with 2FA)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { verifyAdminCaller } from '@/lib/services/adminCallerService';
import { getUnresolvedLocations, saveLocationAlias } from '@/lib/services/campaignReportLocationsService';
import { getErrorMessage } from '@/lib/errorUtils';

async function authorize(request: NextRequest): Promise<NextResponse | null> {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[admin/campaign-reports/locations] SUPABASE_SERVICE_ROLE_KEY is not set');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const caller = await verifyAdminCaller(supabaseAdmin, token);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  return null;
}

export async function GET(request: NextRequest) {
  const denied = await authorize(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await getUnresolvedLocations(supabaseAdmin));
  } catch (err) {
    console.error('[admin/campaign-reports/locations] GET failed:', err);
    return NextResponse.json({ error: getErrorMessage(err, 'Failed to load locations') }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await authorize(request);
  if (denied) return denied;

  let body: { locationKey?: unknown; state?: unknown; place?: unknown; newPlace?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  if (!str(body.locationKey) || !str(body.state)) {
    return NextResponse.json({ error: 'Missing location or state' }, { status: 400 });
  }

  try {
    const result = await saveLocationAlias(supabaseAdmin, {
      locationKey: str(body.locationKey)!, state: str(body.state)!, place: str(body.place), newPlace: str(body.newPlace),
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, rowsUpdated: result.rowsUpdated });
  } catch (err) {
    console.error('[admin/campaign-reports/locations] POST failed:', err);
    return NextResponse.json({ error: getErrorMessage(err, 'Failed to save') }, { status: 500 });
  }
}
