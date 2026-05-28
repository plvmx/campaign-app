/**
 * Server-side admin settings mutation.
 * POST body: { key: string, value: string, description?: string }
 * Authorization: Bearer <supabase_access_token>
 *
 * Verifies the caller is an authenticated admin before writing to app_settings.
 * This ensures settings cannot be mutated by non-admins even if Supabase RLS
 * is misconfigured, because the write goes through the service-role client only
 * after server-side admin verification.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { normalizeName } from '@/lib/auth';

const ALLOWED_SETTING_KEYS = new Set([
  'campaign_logging_enabled',
  'slide_view_leaders',
  'slide_view_sr',
  'slide_view_admin',
]);

export async function POST(request: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[admin/settings] SUPABASE_SERVICE_ROLE_KEY is not set');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Extract Bearer token from Authorization header
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify the token and get the user
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify admin status via user_profiles + state_leaders
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

  // Parse and validate the body
  let body: { key?: unknown; value?: unknown; description?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const key         = typeof body.key         === 'string' ? body.key         : null;
  const value       = typeof body.value       === 'string' ? body.value       : null;
  const description = typeof body.description === 'string' ? body.description : null;

  if (!key || value === null) {
    return NextResponse.json({ error: 'Missing key or value' }, { status: 400 });
  }

  // Allowlist of valid setting keys — prevents writing arbitrary rows
  if (!ALLOWED_SETTING_KEYS.has(key)) {
    return NextResponse.json({ error: 'Unknown setting key' }, { status: 400 });
  }

  const { error: upsertError } = await supabaseAdmin
    .from('app_settings')
    .upsert(
      { setting_key: key, setting_value: value, ...(description ? { description } : {}) },
      { onConflict: 'setting_key' },
    );

  if (upsertError) {
    console.error('[admin/settings] upsert error:', upsertError);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
