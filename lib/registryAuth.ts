/**
 * Thin Supabase-SDK glue for the /registry portal. The actual gating
 * decision lives in lib/registryPipeline/mfaGate.ts (pure, unit tested);
 * this file only fetches the values that decision needs and wires up the
 * session-indicator cookie, same pattern as lib/auth.ts's app_session for
 * the main app. Not independently unit tested — same precedent as this
 * app's other thin SDK adapters (e.g. supabase/functions/ac-sync/db.ts) —
 * exercised instead via the page-level tests under app/registry/.
 */
import { registrySupabase } from './registrySupabaseClient';
import { evaluateMfaGate, type MfaGateResult, type LeaderRoleRow } from './registryPipeline/mfaGate';

const REGISTRY_AUTH_COOKIE = 'registry_auth';       // set once a session exists, MFA outcome pending — lets middleware admit /registry/mfa/*
const REGISTRY_SESSION_COOKIE = 'registry_session'; // set once the full MFA gate has passed — required for the rest of /registry

function setCookie(name: string): void {
  if (typeof document === 'undefined') return;
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=1; path=/registry; SameSite=Lax${secure}`;
}

function clearCookie(name: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; path=/registry; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
}

/** Call right after a successful magic-link code exchange, before the MFA gate is evaluated. */
export function setRegistryAuthCookie(): void {
  setCookie(REGISTRY_AUTH_COOKIE);
}

export function setRegistrySessionCookie(): void {
  setCookie(REGISTRY_SESSION_COOKIE);
}

export function clearRegistrySessionCookie(): void {
  clearCookie(REGISTRY_AUTH_COOKIE);
  clearCookie(REGISTRY_SESSION_COOKIE);
}

async function getOwnLeaderRole(): Promise<LeaderRoleRow | null> {
  // RLS (leader_roles_select_own) already restricts this to the caller's
  // own row, so no explicit .eq('user_id', ...) is needed.
  const { data, error } = await registrySupabase
    .schema('registry')
    .from('leader_roles')
    .select('role, mfa_required')
    .maybeSingle();

  if (error) {
    console.error('getOwnLeaderRole: failed to read registry.leader_roles', error);
    return null;
  }
  return (data as LeaderRoleRow | null) ?? null;
}

/**
 * Gathers everything evaluateMfaGate() needs and returns its verdict, plus
 * the leader role row (pages need the role/state to render, not just the
 * routing decision).
 */
export async function getRegistryAccessState(): Promise<{ result: MfaGateResult; leaderRole: LeaderRoleRow | null }> {
  const { data: { session } } = await registrySupabase.auth.getSession();
  if (!session) {
    return { result: evaluateMfaGate({ hasSession: false, leaderRole: null, currentLevel: null, hasVerifiedTotpFactor: false }), leaderRole: null };
  }

  const [leaderRole, aalResult, factorsResult] = await Promise.all([
    getOwnLeaderRole(),
    registrySupabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    registrySupabase.auth.mfa.listFactors(),
  ]);

  const currentLevel = (aalResult.data?.currentLevel ?? 'aal1') as 'aal1' | 'aal2';
  const hasVerifiedTotpFactor = (factorsResult.data?.totp ?? []).some((f) => f.status === 'verified');

  const result = evaluateMfaGate({ hasSession: true, leaderRole, currentLevel, hasVerifiedTotpFactor });
  return { result, leaderRole };
}

export async function signOutOfRegistry(): Promise<void> {
  await registrySupabase.auth.signOut();
  clearRegistrySessionCookie();
}
