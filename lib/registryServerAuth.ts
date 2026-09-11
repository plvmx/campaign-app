/**
 * Server-side counterpart to lib/registryAuth.ts's client-side MFA gate —
 * for Next.js API routes (app/api/registry/*) that need to verify a
 * caller is a fully-authenticated registry admin (signed in AND, if their
 * role requires it, at aal2) before returning sensitive data. Same
 * Bearer-token-verification pattern already used by app/api/admin/settings.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateMfaGate, type LeaderRoleRow } from './registryPipeline/mfaGate';

/**
 * Reads the `aal` claim out of a Supabase access token's JWT payload,
 * without verifying the signature — safe here because the token has
 * already round-tripped through supabase.auth.getUser(token) (which does
 * verify it against the auth server) before this is ever called.
 */
export function decodeAalFromAccessToken(accessToken: string): 'aal1' | 'aal2' | null {
  try {
    const payloadB64 = accessToken.split('.')[1];
    if (!payloadB64) return null;
    const json = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    const claims = JSON.parse(json) as { aal?: unknown };
    return claims.aal === 'aal2' ? 'aal2' : claims.aal === 'aal1' ? 'aal1' : null;
  } catch {
    return null;
  }
}

/**
 * Verifies a Bearer access token belongs to a registry admin whose MFA
 * gate is fully satisfied (mirrors evaluateMfaGate's 'ok' result). Returns
 * null for anything short of that — no session, no leader_roles row, or
 * MFA required but not yet at aal2 — so callers can treat this as a
 * single unauthorized/authorized check without re-deriving the gate logic.
 * Also returns the caller's own email, for routes that need to attribute
 * a write to who made it (e.g. registry.registrant_edits — see
 * app/api/registry/manage-record/route.ts).
 *
 * Not independently unit tested — thin SDK glue, same precedent as
 * lib/registryAuth.ts's getRegistryAccessState(); the actual decision
 * logic (evaluateMfaGate) and decodeAalFromAccessToken above are.
 */
export async function verifyRegistryAdminRequest(
  supabaseAdmin: SupabaseClient,
  accessToken: string,
): Promise<{ userId: string; email: string | null; leaderRole: LeaderRoleRow } | null> {
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(accessToken);
  if (userError || !user) return null;

  const { data: leaderRole, error: roleError } = await supabaseAdmin
    .schema('registry')
    .from('leader_roles')
    .select('role, mfa_required')
    .eq('user_id', user.id)
    .maybeSingle();
  if (roleError || !leaderRole) return null;

  const currentLevel = decodeAalFromAccessToken(accessToken);
  const result = evaluateMfaGate({
    hasSession: true,
    leaderRole: leaderRole as LeaderRoleRow,
    currentLevel,
    // Only distinguishes needs_enrollment vs needs_challenge, both of
    // which this function treats identically (not 'ok') — approximating
    // it from currentLevel alone is fine for a pure authorization check.
    hasVerifiedTotpFactor: currentLevel === 'aal2',
  });
  if (result !== 'ok') return null;

  return { userId: user.id, email: user.email ?? null, leaderRole: leaderRole as LeaderRoleRow };
}
