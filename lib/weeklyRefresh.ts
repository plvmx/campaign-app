import { supabase } from './supabaseClient';

export interface LeaderNotSignedIn {
  id: string;
  state: string;
  leader: string;
  mobile: string | null;
  admin: string | null;
  last_sign_in_at: string | null;
}

/**
 * Get the completed_at timestamp of the most recent Weekly Refresh run.
 * Returns null if no refresh has been logged yet.
 */
export async function getLastWeeklyRefreshAt(): Promise<Date | null> {
  const { data, error } = await supabase
    .from('weekly_refresh_log')
    .select('completed_at')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching last weekly refresh:', error);
    throw error;
  }

  return data?.completed_at ? new Date(data.completed_at) : null;
}

/**
 * Get leaders who have not signed in since the last Weekly Refresh.
 * If no refresh has been logged, returns all leaders who have never signed in (last_sign_in_at IS NULL).
 */
export async function getLeadersNotSignedInSinceRefresh(): Promise<{
  leaders: LeaderNotSignedIn[];
  lastRefreshAt: Date | null;
}> {
  const lastRefreshAt = await getLastWeeklyRefreshAt();

  const query = supabase
    .from('state_leaders')
    .select('id, state, leader, mobile, admin, last_sign_in_at')
    .order('state', { ascending: true })
    .order('leader', { ascending: true });

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching state leaders:', error);
    throw error;
  }

  const all = (data || []) as LeaderNotSignedIn[];

  const leaders = lastRefreshAt
    ? all.filter(
        (row) =>
          row.last_sign_in_at == null || new Date(row.last_sign_in_at) < lastRefreshAt
      )
    : all.filter((row) => row.last_sign_in_at == null);

  return { leaders, lastRefreshAt };
}

/**
 * Get leaders in a given state who have not signed in since the last Weekly Refresh.
 * For State Reporters to see their state only.
 */
export async function getLeadersNotSignedInSinceRefreshByState(state: string): Promise<{
  leaders: LeaderNotSignedIn[];
  lastRefreshAt: Date | null;
}> {
  const normalizedState = state?.toUpperCase().trim();
  if (!normalizedState) {
    return { leaders: [], lastRefreshAt: null };
  }
  const { leaders, lastRefreshAt } = await getLeadersNotSignedInSinceRefresh();
  const leadersInState = leaders.filter((row) => row.state.toUpperCase() === normalizedState);
  return { leaders: leadersInState, lastRefreshAt };
}
