import { supabase } from './supabaseClient';
import { getUserProfile } from './userProfile';
import { normalizeMobile, normalizeName } from './auth';

/**
 * Get the user's admin status, state, mobile, and leader from state_leaders table in a single query
 * This is optimized to fetch all needed data in one database call instead of multiple separate calls
 * Returns { admin: string | null, state: string | null, mobile: string | null, leader: string | null }
 */
export async function getUserAdminStatusAndMobile(): Promise<{ 
  admin: string | null; 
  state: string | null; 
  mobile: string | null; 
  leader: string | null;
}> {
  try {
    const profile = await getUserProfile();
    if (!profile?.name || !profile?.state) {
      console.log('getUserAdminStatusAndMobile: No profile name or state');
      return { admin: null, state: null, mobile: null, leader: null };
    }

    // Look up admin status from state_leaders table using name and state
    const normalizedName = normalizeName(profile.name);
    
    // Normalize state to uppercase for consistent matching (VIC, NSW, etc.)
    const normalizedState = profile.state.toUpperCase().trim();
    
    // Fetch all needed fields in a single query
    const { data: allLeaders, error } = await supabase
      .from('state_leaders')
      .select('admin, leader, state, mobile')
      .eq('state', normalizedState);

    if (error) {
      console.error('getUserAdminStatusAndMobile: Error fetching leaders:', error);
      return { admin: null, state: normalizedState, mobile: null, leader: null };
    }

    if (!allLeaders || allLeaders.length === 0) {
      console.log('getUserAdminStatusAndMobile: No leaders found for state:', normalizedState);
      return { admin: null, state: normalizedState, mobile: null, leader: null };
    }

    // Find matching record with case-insensitive name comparison (exact match only)
    const match = allLeaders.find(record => {
      const recordNameNormalized = normalizeName(record.leader || '');
      // Exact match only - no suffix stripping
      return recordNameNormalized === normalizedName;
    });
    
    if (match) {
      console.log('getUserAdminStatusAndMobile: Found match:', { 
        profileName: profile.name, 
        leaderName: match.leader, 
        admin: match.admin, 
        state: match.state 
      });
      return {
        admin: match.admin || null,
        state: (match.state || normalizedState).toUpperCase().trim(),
        mobile: match.mobile || null,
        leader: match.leader || null,
      };
    }
    
    console.log('getUserAdminStatusAndMobile: No match found for name:', profile.name, 'in state:', normalizedState);
    return { admin: null, state: normalizedState, mobile: null, leader: null };
  } catch (error) {
    console.error('Error getting user admin status and mobile:', error);
    return { admin: null, state: null, mobile: null, leader: null };
  }
}

/**
 * Get the user's admin status and state from state_leaders table
 * Returns { admin: string | null, state: string | null }
 * admin: 'AD' (admin), 'SR' (state reporter), or null/empty (regular user)
 * state: The state code from the matched state_leaders record
 * 
 * @deprecated Use getUserAdminStatusAndMobile() instead for better performance
 */
export async function getUserAdminStatus(): Promise<{ admin: string | null; state: string | null }> {
  const { admin, state } = await getUserAdminStatusAndMobile();
  return { admin, state };
}

/**
 * Get the user's mobile and leader from their profile and state_leaders table
 * Returns { mobile: string | null, leader: string | null } or null if not found
 * 
 * @deprecated Use getUserAdminStatusAndMobile() instead for better performance
 */
export async function getUserMobileAndLeader(): Promise<{ mobile: string | null; leader: string | null } | null> {
  const { mobile, leader } = await getUserAdminStatusAndMobile();
  if (!mobile && !leader) {
    return null;
  }
  return { mobile, leader };
}

/**
 * Get a Supabase query builder filtered by the current user's mobile and leader
 * Returns null if user's mobile/leader cannot be determined
 */
export async function getFilteredCampaignsQuery() {
  const userMobileAndLeader = await getUserMobileAndLeader();
  
  if (!userMobileAndLeader || !userMobileAndLeader.mobile || !userMobileAndLeader.leader) {
    return null;
  }

  // Normalize mobile for comparison (remove spaces, etc.)
  const normalizedMobile = normalizeMobile(userMobileAndLeader.mobile);
  
  // Get all campaigns and filter in memory to handle mobile normalization
  // This is necessary because mobile numbers in DB might have different formatting
  let query = supabase
    .from('campaigns')
    .select('*');

  return { query, mobile: normalizedMobile, leader: userMobileAndLeader.leader };
}

