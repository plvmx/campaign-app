/**
 * Saves a manual correction to one campaign_reports row's
 * derived_state/derived_place/derived_leader — see
 * lib/services/campaignReportsService.ts (updateCampaignReportDerivedFields)
 * and the cleanup screen at /admin/campaign-reports-cleanup.
 *
 * Goes through the service role because campaign_reports has no authenticated
 * write policy (see the comment above its RLS block in
 * supabase/rls-policies.sql) — only the service role writes to this table for
 * now, same as the import/backfill scripts.
 *
 * POST body: { id: string, derived_state: string | null, derived_place: string | null, derived_leader: string | null }
 * Authorization: Bearer <supabase_access_token>  (caller must be a full admin)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { normalizeName } from '@/lib/auth';
import { enforceOrigin } from '@/lib/corsUtils';
import { AUSTRALIAN_STATES } from '@/lib/constants';

export async function POST(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[admin/campaign-reports/derived-fields] SUPABASE_SERVICE_ROLE_KEY is not set');
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

  const { data: leaderRows } = await supabaseAdmin
    .from('state_leaders')
    .select('admin')
    .eq('state', profile.state.toUpperCase().trim())
    .ilike('leader', normalizeName(profile.name))
    .limit(1);

  const adminStatus = leaderRows?.[0]?.admin ?? null;
  if (adminStatus !== 'AD') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { id?: unknown; derived_state?: unknown; derived_place?: unknown; derived_leader?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : null;
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  // Each field is either a non-empty string or explicitly null (clearing a
  // previously-set value) — an empty string is treated the same as null so a
  // cleared form field doesn't get stored as "".
  const cleanField = (value: unknown): string | null | undefined => {
    if (value === null) return null;
    if (typeof value === 'string') return value.trim() || null;
    return undefined; // field omitted — leave untouched below
  };

  const derivedState  = cleanField(body.derived_state);
  const derivedPlace  = cleanField(body.derived_place);
  const derivedLeader = cleanField(body.derived_leader);

  if (derivedState !== undefined && derivedState !== null && !AUSTRALIAN_STATES.includes(derivedState as never)) {
    return NextResponse.json({ error: `Invalid state: ${derivedState}` }, { status: 400 });
  }

  const updates: Record<string, string | null> = {};
  if (derivedState !== undefined) updates.derived_state = derivedState;
  if (derivedPlace !== undefined) updates.derived_place = derivedPlace;
  if (derivedLeader !== undefined) updates.derived_leader = derivedLeader;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { error: updateError } = await supabaseAdmin
    .from('campaign_reports')
    .update(updates)
    .eq('id', id);

  if (updateError) {
    console.error('[admin/campaign-reports/derived-fields] update failed:', updateError);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
