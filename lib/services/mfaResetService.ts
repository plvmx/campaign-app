import type { SupabaseClient } from '@supabase/supabase-js';

export type ResetMfaResult =
  | { ok: true; factorsRemoved: number; rowsReset: number }
  | { ok: false; status: number; error: string };

/**
 * Resets a leader's two-factor authentication (an admin's "lost phone"
 * recovery): deletes every MFA factor on the leader's auth account, clears
 * mfa_enrolled_at on every state_leaders row bound to that account, and
 * deletes the account's user_profiles/user_roles rows so any session it
 * still holds loses its app identity immediately. The leader must then sign
 * in again — for an admin that means going through the normal email + 2FA
 * setup before they can get back in. Never lets an admin reset their own
 * (a lost phone is the case where they can't be signed in to ask anyway, and
 * resetting yourself mid-session is just a way to lock yourself out).
 *
 * The audit row is best-effort — it never blocks the reset itself (the table
 * comes from scripts/create_state_leader_mfa_resets_table.sql).
 * Injected client, always supabaseAdmin.
 */
export async function resetLeaderMfa(
  client: SupabaseClient,
  params: { leaderId: string; actorUserId: string; actorLabel: string },
): Promise<ResetMfaResult> {
  const { leaderId, actorUserId, actorLabel } = params;

  const { data: target, error: targetError } = await client
    .from('state_leaders')
    .select('id, user_id')
    .eq('id', leaderId)
    .maybeSingle();
  if (targetError) {
    console.error('reset-mfa: leader lookup failed:', targetError);
    return { ok: false, status: 500, error: 'Internal server error' };
  }
  if (!target) return { ok: false, status: 404, error: 'Leader not found' };

  const targetUserId = (target as { user_id: string | null }).user_id;
  if (!targetUserId) {
    return { ok: false, status: 409, error: 'This leader has no email sign-in account yet, so there is no 2FA to reset.' };
  }
  if (targetUserId === actorUserId) {
    return { ok: false, status: 400, error: "You can't reset your own 2FA — ask another admin to do it." };
  }

  const { data: factorData, error: listError } = await client.auth.admin.mfa.listFactors({ userId: targetUserId });
  if (listError) {
    console.error('reset-mfa: listFactors failed:', listError);
    return { ok: false, status: 500, error: 'Internal server error' };
  }
  const factors = factorData?.factors ?? [];
  for (const factor of factors) {
    const { error: deleteError } = await client.auth.admin.mfa.deleteFactor({ id: factor.id, userId: targetUserId });
    if (deleteError) {
      console.error('reset-mfa: deleteFactor failed:', deleteError);
      return { ok: false, status: 500, error: 'Internal server error' };
    }
  }

  const { error: clearError, count } = await client
    .from('state_leaders')
    .update({ mfa_enrolled_at: null }, { count: 'exact' })
    .eq('user_id', targetUserId);
  if (clearError) {
    console.error('reset-mfa: clearing mfa_enrolled_at failed:', clearError);
    return { ok: false, status: 500, error: 'Internal server error' };
  }

  // End any live session's app identity right away (RLS is_admin() reads user_profiles).
  for (const table of ['user_profiles', 'user_roles'] as const) {
    const { error } = await client.from(table).delete().eq('user_id', targetUserId);
    if (error) console.warn(`reset-mfa: failed to clear ${table}:`, error);
  }

  const { error: auditError } = await client.from('state_leader_mfa_resets').insert([
    { state_leader_id: leaderId, target_user_id: targetUserId, reset_by: actorLabel, reset_by_user_id: actorUserId },
  ]);
  if (auditError) console.warn('reset-mfa: failed to record audit row:', auditError);

  return { ok: true, factorsRemoved: factors.length, rowsReset: count ?? 0 };
}
