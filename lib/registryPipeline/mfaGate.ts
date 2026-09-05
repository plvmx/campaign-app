// Pure decision logic for the /registry portal's post-login gate. Kept
// framework/SDK-free (no supabase-js types) so it's trivially unit
// testable — the pages under app/registry/ call this with values already
// read from the Supabase JS SDK (session presence, the leader's
// registry.leader_roles row, current AAL, and whether a verified TOTP
// factor exists) and act on the result.
//
// See docs/registry-pipeline/BRIEF.md ("Supabase Auth (magic-link) rollout
// for leaders" + "MFA enforcement for national_admin / whatsapp_admin
// roles") and registry.has_required_mfa() (scripts/create_registry_leader_roles_table.sql)
// for the server-side equivalent of this same rule, enforced independently
// at the database level — this function only controls client-side routing
// (which screen to show next), it is not itself a security boundary.

export type MfaGateResult =
  | 'unauthenticated'   // no Supabase Auth session at all -> send to /registry/login
  | 'no_access'         // signed in, but no registry.leader_roles row -> /registry/no-access
  | 'needs_enrollment'  // role requires MFA, no verified TOTP factor yet -> /registry/mfa/enroll
  | 'needs_challenge'   // role requires MFA, factor exists, session is only aal1 -> /registry/mfa/challenge
  | 'ok';               // clear to enter /registry

export interface LeaderRoleRow {
  role: 'state_leader' | 'national_admin' | 'whatsapp_admin';
  mfa_required: boolean;
}

export interface MfaGateInput {
  hasSession: boolean;
  /** The signed-in user's own registry.leader_roles row, or null if none exists (RLS already scopes this to "own row only"). */
  leaderRole: LeaderRoleRow | null;
  /** From supabase.auth.mfa.getAuthenticatorAssuranceLevel() — null only when hasSession is false. */
  currentLevel: 'aal1' | 'aal2' | null;
  /** Whether the user has at least one verified TOTP factor (supabase.auth.mfa.listFactors()). */
  hasVerifiedTotpFactor: boolean;
}

export function evaluateMfaGate(input: MfaGateInput): MfaGateResult {
  if (!input.hasSession) return 'unauthenticated';
  if (!input.leaderRole) return 'no_access';
  if (!input.leaderRole.mfa_required) return 'ok';
  if (input.currentLevel === 'aal2') return 'ok';
  if (!input.hasVerifiedTotpFactor) return 'needs_enrollment';
  return 'needs_challenge';
}
