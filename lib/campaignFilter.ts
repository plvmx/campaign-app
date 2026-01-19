import { supabase } from './supabaseClient';
import { getUserProfile } from './userProfile';
import { normalizeMobile, normalizeName } from './auth';

/**
 * Get the user's admin status and state from state_leaders table
 * Returns { admin: string | null, state: string | null }
 * admin: 'AD' (admin), 'SR' (state reporter), or null/empty (regular user)
 * state: The state code from the matched state_leaders record
 */
export async function getUserAdminStatus(): Promise<{ admin: string | null; state: string | null }> {
  try {
    const profile = await getUserProfile();
    if (!profile?.name || !profile?.state) {
      console.log('getUserAdminStatus: No profile name or state');
      return { admin: null, state: null };
    }

    // Look up admin status from state_leaders table using name and state
    const normalizedName = normalizeName(profile.name);
    
    // Normalize state to uppercase for consistent matching (VIC, NSW, etc.)
    const normalizedState = profile.state.toUpperCase().trim();
    
    // Fetch all leaders for the state and do case-insensitive matching
    // Normalize state to uppercase for consistent matching
    const { data: allLeaders, error } = await supabase
      .from('state_leaders')
      .select('admin, leader, state')
      .eq('state', normalizedState); // State should be normalized to uppercase

    if (error) {
      console.error('getUserAdminStatus: Error fetching leaders:', error);
      return { admin: null, state: normalizedState };
    }

    if (!allLeaders || allLeaders.length === 0) {
      console.log('getUserAdminStatus: No leaders found for state:', normalizedState);
      return { admin: null, state: normalizedState };
    }

    // Find matching record with case-insensitive name comparison (exact match only)
    const match = allLeaders.find(record => {
      const recordNameNormalized = normalizeName(record.leader || '');
      // Exact match only - no suffix stripping
      return recordNameNormalized === normalizedName;
    });
    
    if (match) {
      console.log('getUserAdminStatus: Found match:', { 
        profileName: profile.name, 
        leaderName: match.leader, 
        admin: match.admin, 
        state: match.state 
      });
      return {
        admin: match.admin || null,
        state: (match.state || normalizedState).toUpperCase().trim(), // Normalize state to uppercase
      };
    }
    
    console.log('getUserAdminStatus: No match found for name:', profile.name, 'in state:', normalizedState);
    return { admin: null, state: normalizedState }; // No match found, use profile state
  } catch (error) {
    console.error('Error getting user admin status:', error);
    return { admin: null, state: null };
  }
}

/**
 * Get the user's mobile and leader from their profile and state_leaders table
 * Returns { mobile: string | null, leader: string | null } or null if not found
 */
export async function getUserMobileAndLeader(): Promise<{ mobile: string | null; leader: string | null } | null> {
  try {
    const profile = await getUserProfile();
    if (!profile?.name || !profile?.state) {
      return null;
    }

    // Look up mobile from state_leaders table using name and state
    const normalizedName = normalizeName(profile.name);
    
    // Normalize state to uppercase for consistent matching
    const normalizedState = profile.state.toUpperCase().trim();
    
    // Fetch all leaders for the state and do case-insensitive matching
    const { data: allLeaders, error } = await supabase
      .from('state_leaders')
      .select('mobile, leader')
      .eq('state', normalizedState);

    if (error || !allLeaders) {
      return null;
    }

    // Find matching record with case-insensitive name comparison
    const match = allLeaders.find(record => 
      normalizeName(record.leader || '') === normalizedName
    );
    
    if (match) {
      return {
        mobile: match.mobile,
        leader: match.leader,
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error getting user mobile and leader:', error);
    return null;
  }
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

