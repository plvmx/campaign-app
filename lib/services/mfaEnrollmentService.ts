import type { SupabaseClient } from '@supabase/supabase-js';

export type CompleteEnrollmentResult =
  | { ok: true; enrolledRows: number }
  | { ok: false; status: number; error: string };

/** Escapes LIKE/ILIKE wildcards so an address is matched literally — `_` is
 * common in email local-parts and would otherwise match any character. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/**
 * Finishes MFA enrollment for a verified session (caller has already checked
 * the session has a verified factor).
 *
 * Step 1 binds `user_id` on every still-unbound state_leaders row whose
 * `email` is the address this session just proved inbox control of. A row's
 * `email` is trusted by construction — it is only ever set by a completed
 * self-serve confirmation (which binds user_id itself) or typed in by an
 * admin, which counts as confirmed — so the person who has just proved they
 * control that inbox *and* holds a verified authenticator is entitled to be
 * tied to those rows. Without this, an admin-entered email never got a
 * user_id: setup finished, but only the one row the account happened to be
 * bound to was marked enrolled, and the rest (e.g. a leader's AD row) could
 * never appear under email sign-in (found 2026-10-12). Rows already bound to
 * a different account are never touched.
 *
 * Step 2 stamps mfa_enrolled_at on every row now bound to this account.
 * Injected client (always supabaseAdmin) like backupService.ts's exportBackup.
 */
export async function completeMfaEnrollment(
  client: SupabaseClient,
  params: { userId: string; email: string | null | undefined },
): Promise<CompleteEnrollmentResult> {
  const { userId, email } = params;
  const now = new Date().toISOString();

  if (email) {
    const { error: bindError } = await client
      .from('state_leaders')
      .update({ user_id: userId, email_confirmed_at: now })
      .is('user_id', null)
      .ilike('email', escapeLikePattern(email.trim()));
    if (bindError) {
      console.error('complete-mfa-setup: failed to bind user_id:', bindError);
      return { ok: false, status: 500, error: 'Internal server error' };
    }
  }

  const { error: updateError, count } = await client
    .from('state_leaders')
    .update({ mfa_enrolled_at: now }, { count: 'exact' })
    .eq('user_id', userId);
  if (updateError) {
    console.error('complete-mfa-setup: failed to write mfa_enrolled_at:', updateError);
    return { ok: false, status: 500, error: 'Internal server error' };
  }
  if (!count) {
    return { ok: false, status: 404, error: 'No matching leader record found for this account' };
  }
  return { ok: true, enrolledRows: count };
}
