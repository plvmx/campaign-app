import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { normalizeMobile, normalizeName } from '@/lib/auth';

export interface VerifiedStateLeaderRow {
  id: string;
  state: string;
  leader: string;
  mobile: string | null;
  admin: string | null;
  email: string | null;
  pending_email: string | null;
  mfa_enrolled_at: string | null;
}

/**
 * Server-side mobile+name verification against state_leaders, shared by
 * app/api/auth/validate-leader/route.ts (the original login check) and
 * app/api/auth/propose-email/route.ts (which must re-verify the same pair
 * rather than trust a bare leaderId — see that route's own comment).
 * Extracted so the two routes can't drift apart on this security-sensitive
 * matching logic, per this project's standing rule against duplicating
 * that kind of check (see stateLeadersService.ts's assertValidAdminValue).
 *
 * Uses supabaseAdmin (service role) — callers run unauthenticated, before
 * any session exists.
 */
export async function findVerifiedStateLeaders(
  mobile: string,
  firstName: string,
): Promise<VerifiedStateLeaderRow[]> {
  const mobileNormalized = normalizeMobile(mobile);
  const firstNameNormalized = normalizeName(firstName);

  if (!mobileNormalized || !firstNameNormalized) return [];

  // Prefix-match on leader name to limit the result set while still tolerating
  // trailing whitespace in stored values (e.g. "Rosheen "). The JS filter below
  // enforces an exact normalised-name match, so "Rosh" will never match "Rosheen".
  const { data, error } = await supabaseAdmin
    .from('state_leaders')
    .select('id, state, leader, mobile, admin, email, pending_email, mfa_enrolled_at')
    .ilike('leader', `${firstNameNormalized}%`);

  if (error) throw error;
  if (!data || data.length === 0) return [];

  return (data as VerifiedStateLeaderRow[]).filter((rec) => {
    const storedNameNormalized = normalizeName(rec.leader ?? '');
    if (storedNameNormalized !== firstNameNormalized) return false;
    if (!rec.mobile) return false;
    return normalizeMobile(rec.mobile) === mobileNormalized;
  });
}
