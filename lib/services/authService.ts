import { supabase } from '@/lib/supabaseClient';
import { normalizeName } from '@/lib/auth';
import type { UserProfile } from '@/lib/types';

export interface AuthenticatedUser {
  user: { id: string; email?: string };
  profile: UserProfile | null;
  adminStatus: string | null;
  isAdmin: boolean;
  userState: string | null;
  userLeader: string | null;
  userMobile: string | null;
}

/**
 * Single-round-trip auth resolution: one auth check + one user_profiles query +
 * one state_leaders query, replacing the prior 4×getCurrentUser + 2×user_profiles +
 * 2×state_leaders pattern that ran on every page load.
 */
export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) return null;

  const { data: profileData, error: profileError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (profileError && profileError.code !== 'PGRST116') throw profileError;

  const profile: UserProfile | null = profileData ?? null;

  if (!profile?.name || !profile?.state) {
    return {
      user: { id: user.id, email: user.email },
      profile,
      adminStatus: null,
      isAdmin: false,
      userState: profile?.state ? profile.state.toUpperCase().trim() : null,
      userLeader: null,
      userMobile: null,
    };
  }

  const normalizedState = profile.state.toUpperCase().trim();
  const normalizedName = normalizeName(profile.name);

  const { data: leaderRows } = await supabase
    .from('state_leaders')
    .select('admin, leader, state, mobile')
    .eq('state', normalizedState)
    .ilike('leader', normalizedName);

  const match = leaderRows && leaderRows.length > 0 ? leaderRows[0] : null;
  const adminStatus = match?.admin ?? null;

  return {
    user: { id: user.id, email: user.email },
    profile,
    adminStatus,
    isAdmin: adminStatus === 'AD',
    userState: match ? (match.state as string).toUpperCase().trim() : normalizedState,
    userLeader: match?.leader ?? null,
    userMobile: match?.mobile ?? null,
  };
}
