import type { SupabaseClient } from '@supabase/supabase-js';
import { findVerifiedStateLeaders } from '@/lib/services/leaderVerificationService';

export type GrantRequest =
  | { method: 'mobile-name'; leaderId: string; mobile: string; firstName: string }
  | { method: 'real-auth'; leaderId: string };

export type GrantResult = { ok: true } | { ok: false; status: number; error: string };

interface GrantedLeader {
  leader: string;
  state: string;
  admin: string | null;
}

/** Reads the `aal` claim from a JWT payload. Only call this on a token that
 * supabaseAdmin.auth.getUser() has already validated — it does not verify the
 * signature itself. */
export function getAalFromJwt(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const aal = (JSON.parse(json) as { aal?: unknown }).aal;
    return typeof aal === 'string' ? aal : null;
  } catch {
    return null;
  }
}

/**
 * Writes the user_profiles / user_roles rows that every "who is this / are
 * they admin" consumer (UserContext, campaignFilter.ts, RLS is_admin(), the
 * admin API routes) reads for a session — but only after verifying, on the
 * server, that the caller is entitled to the leader row they're asking for.
 * Before this existed the browser wrote those rows itself, and user_roles'
 * RLS let any signed-in session (including a bare anonymous one) write its
 * own `admin` row — so the login screen was the only thing standing between
 * anyone and admin access (found 2026-10-11). Takes an injected client
 * (always supabaseAdmin in practice) like backupService.ts's exportBackup.
 *
 * Two ways to prove entitlement:
 * - 'mobile-name': the legacy login. Re-verifies the typed mobile+first name
 *   against state_leaders on the server (a bare leaderId is never trusted)
 *   and that the chosen leaderId is one of the verified matches.
 * - 'real-auth': the email + MFA login. The session's user must be the
 *   state_leaders row's bound user_id AND the token must be at aal2.
 *
 * A non-AD leader explicitly has any existing admin role deleted, since a
 * real-auth user_id persists across logins and a different role may be
 * picked each time.
 */
export async function grantSessionAccess(
  client: SupabaseClient,
  params: {
    userId: string;
    aal: string | null;
    request: GrantRequest;
    verifyLeaders?: typeof findVerifiedStateLeaders;
  },
): Promise<GrantResult> {
  const { userId, aal, request, verifyLeaders = findVerifiedStateLeaders } = params;

  let leader: GrantedLeader | null = null;

  if (request.method === 'mobile-name') {
    const matches = await verifyLeaders(request.mobile, request.firstName);
    leader = matches.find((m) => m.id === request.leaderId) ?? null;
    if (!leader) return { ok: false, status: 403, error: 'No matching leader found' };
  } else {
    const { data, error } = await client
      .from('state_leaders')
      .select('leader, state, admin, user_id')
      .eq('id', request.leaderId)
      .maybeSingle();
    if (error) {
      console.error('grant-session-access: leader lookup failed:', error);
      return { ok: false, status: 500, error: 'Internal server error' };
    }
    if (!data || data.user_id !== userId || aal !== 'aal2') {
      return { ok: false, status: 403, error: 'Not authorised for this leader' };
    }
    leader = data as GrantedLeader;
  }

  const { error: profileError } = await client
    .from('user_profiles')
    .upsert({ user_id: userId, name: leader.leader.trim(), state: leader.state }, { onConflict: 'user_id' });
  if (profileError) {
    console.error('grant-session-access: profile write failed:', profileError);
    return { ok: false, status: 500, error: 'Internal server error' };
  }

  const { error: roleError } =
    leader.admin === 'AD'
      ? await client.from('user_roles').upsert({ user_id: userId, role: 'admin' }, { onConflict: 'user_id' })
      : await client.from('user_roles').delete().eq('user_id', userId);
  if (roleError) {
    console.error('grant-session-access: role write failed:', roleError);
    return { ok: false, status: 500, error: 'Internal server error' };
  }

  return { ok: true };
}
