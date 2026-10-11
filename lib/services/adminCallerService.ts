import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeName } from '@/lib/auth';
import { getAalFromJwt } from '@/lib/services/sessionAccessService';

export type AdminCallerResult =
  | { ok: true; userId: string; label: string }
  | { ok: false; status: number; error: string };

/**
 * Verifies that a Bearer token belongs to a full admin (state_leaders 'AD')
 * who signed in with two-factor authentication (aal2). For high-value admin
 * actions (e.g. resetting another leader's 2FA). Identity is whatever
 * supabaseAdmin.auth.getUser(token) says; the admin row is found by the
 * session's user_profiles name+state, which — since 2026-10-11 — only the
 * server writes (sessionAccessService.ts), and for an AD only after MFA.
 * The aal2 check here is belt-and-braces on top of that.
 *
 * Matches the leader name exactly after normalizing (not ILIKE — `_` in
 * names like "Lorraine_AD" is a LIKE wildcard). The four older inline
 * admin-check routes (app/api/admin/*) predate this and still duplicate the
 * check; migrating them is a follow-up.
 */
export async function verifyAdminCaller(client: SupabaseClient, token: string): Promise<AdminCallerResult> {
  const { data: { user }, error: userError } = await client.auth.getUser(token);
  if (userError || !user) return { ok: false, status: 401, error: 'Unauthorized' };

  if (getAalFromJwt(token) !== 'aal2') {
    return { ok: false, status: 403, error: 'Two-factor sign-in is required for this action' };
  }

  const { data: profile } = await client
    .from('user_profiles')
    .select('name, state')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile?.name || !profile?.state) return { ok: false, status: 403, error: 'Forbidden' };

  const { data: rows } = await client
    .from('state_leaders')
    .select('leader, admin')
    .eq('state', String(profile.state).toUpperCase().trim());
  const wanted = normalizeName(profile.name);
  const row = (rows ?? []).find((r: { leader: string | null }) => normalizeName(r.leader ?? '') === wanted);
  if (!row || row.admin !== 'AD') return { ok: false, status: 403, error: 'Forbidden' };

  return { ok: true, userId: user.id, label: `${row.leader} (${String(profile.state).toUpperCase().trim()})` };
}
