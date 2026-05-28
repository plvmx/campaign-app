/**
 * Immediately revoke all active sessions for a given leader+state.
 *
 * Called by the state-leaders admin page when the `admin` field changes
 * (e.g. demoting an 'AD' admin or promoting someone new). Without this, the
 * affected user's admin-level access persists until their next JWT refresh
 * (~1 hour). This route forces an immediate sign-out via the Supabase auth
 * admin API so the role change takes effect right away.
 *
 * POST body: { state: string, leader: string }
 * Authorization: Bearer <supabase_access_token>  (caller must be an admin)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { normalizeName } from '@/lib/auth';
import { enforceOrigin } from '@/lib/corsUtils';

export async function POST(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[invalidate-user-session] SUPABASE_SERVICE_ROLE_KEY is not set');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Verify caller is an authenticated admin
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: callerProfile } = await supabaseAdmin
    .from('user_profiles')
    .select('name, state')
    .eq('user_id', user.id)
    .single();

  if (!callerProfile?.name || !callerProfile?.state) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: callerLeader } = await supabaseAdmin
    .from('state_leaders')
    .select('admin')
    .eq('state', callerProfile.state.toUpperCase().trim())
    .ilike('leader', normalizeName(callerProfile.name))
    .limit(1)
    .single();

  if (callerLeader?.admin !== 'AD') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Parse target
  let body: { state?: unknown; leader?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const targetState  = typeof body.state  === 'string' ? body.state.toUpperCase().trim() : null;
  const targetLeader = typeof body.leader === 'string' ? body.leader.trim()              : null;

  if (!targetState || !targetLeader) {
    return NextResponse.json({ error: 'state and leader are required' }, { status: 400 });
  }

  // Find all user_profiles that match this leader+state
  const { data: profiles, error: profilesErr } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id')
    .eq('state', targetState)
    .ilike('name', normalizeName(targetLeader));

  if (profilesErr) {
    console.error('[invalidate-user-session] profile lookup failed:', profilesErr);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  if (!profiles?.length) {
    return NextResponse.json({ ok: true, revoked: 0 });
  }

  // Revoke sessions via the Supabase auth admin REST endpoint.
  // The JS SDK's auth.admin.signOut() takes a JWT; for user-ID–based logout
  // we call the underlying REST API directly.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  let revoked = 0;
  for (const { user_id } of profiles) {
    try {
      const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${user_id}/logout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'apikey': serviceKey,
        },
      });
      if (res.ok) revoked++;
    } catch (err) {
      console.error(`[invalidate-user-session] logout failed for ${user_id}:`, err);
    }
  }

  return NextResponse.json({ ok: true, revoked });
}
