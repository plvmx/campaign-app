/**
 * Works out who a Bearer token belongs to *as a leader* — for routes that any
 * signed-in leader may use (not just admins; see adminCallerService.ts for
 * those). Identity is whatever `client.auth.getUser(token)` says; the leader
 * row is found from the session's user_profiles name + state, which only the
 * server writes (sessionAccessService.ts). Returns what
 * `canRecordResultsFor` needs (role, state, name, mobile) plus the campaigns
 * other leaders have shared with this one. Injected client, always
 * supabaseAdmin.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeName } from '@/lib/auth';
import type { LeaderShareOwner } from '@/lib/types';
import type { RecordResultsCaller } from '@/lib/recordResultsAccess';

export type LeaderCallerResult =
  | { ok: true; userId: string; caller: RecordResultsCaller; sharedWithMeOwners: LeaderShareOwner[] }
  | { ok: false; status: number; error: string };

export async function getLeaderCaller(client: SupabaseClient, token: string): Promise<LeaderCallerResult> {
  const { data: { user }, error: userError } = await client.auth.getUser(token);
  if (userError || !user) return { ok: false, status: 401, error: 'Unauthorized' };

  const { data: profile, error: profileError } = await client
    .from('user_profiles')
    .select('name, state')
    .eq('user_id', user.id)
    .maybeSingle();
  if (profileError) throw new Error(`Profile lookup failed: ${profileError.message}`);
  if (!profile?.name || !profile?.state) return { ok: false, status: 403, error: 'Forbidden' };

  const state = String(profile.state).toUpperCase().trim();
  const wanted = normalizeName(profile.name);

  const { data: leaders, error: leadersError } = await client
    .from('state_leaders')
    .select('leader, mobile, admin')
    .eq('state', state);
  if (leadersError) throw new Error(`Leader lookup failed: ${leadersError.message}`);
  const row = (leaders ?? []).find((l: { leader: string | null }) => normalizeName(l.leader ?? '') === wanted) as
    | { leader: string; mobile: string | null; admin: string | null }
    | undefined;
  if (!row) return { ok: false, status: 403, error: 'Forbidden' };

  const { data: shares, error: sharesError } = await client
    .from('leader_shares')
    .select('owner_state, owner_leader, shared_with_leader')
    .eq('shared_with_state', state);
  if (sharesError) throw new Error(`Share lookup failed: ${sharesError.message}`);
  const sharedWithMeOwners = (shares ?? [])
    .filter((s: { shared_with_leader: string | null }) => normalizeName(s.shared_with_leader ?? '') === wanted)
    .map((s: { owner_state: string; owner_leader: string }) => ({ owner_state: s.owner_state, owner_leader: s.owner_leader }));

  return {
    ok: true,
    userId: user.id,
    caller: { adminStatus: row.admin, state, leader: row.leader, mobile: row.mobile },
    sharedWithMeOwners,
  };
}
