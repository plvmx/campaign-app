import { supabase } from './supabaseClient';
import { getUserProfile } from './userProfile';
import { normalizeName } from './auth';

/**
 * Whether an `admin` column value represents a recognized elevated role
 * ('AD' full admin or 'SR' state reporter) as opposed to a regular leader
 * or stray legacy data (e.g. a recruiter's name typed into the column).
 *
 * Always use this instead of re-checking `=== 'AD' || === 'SR'` inline —
 * a truthy check (`if (!match.admin)`) was used in one call site instead
 * of this exact comparison, which silently misrouted leaders whose
 * `admin` column held junk data. Centralizing the check here means it
 * can't drift out of sync at a new call site.
 */
export function isRecognizedAdminStatus(admin: string | null | undefined): admin is 'AD' | 'SR' {
  return admin === 'AD' || admin === 'SR';
}

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
    
    // Filter by both state and leader name at the DB level so we never load
    // the entire state's leaders into memory.
    const { data: matchedLeaders, error } = await supabase
      .from('state_leaders')
      .select('admin, leader, state, mobile')
      .eq('state', normalizedState)
      .ilike('leader', normalizedName);

    if (error) {
      console.error('getUserAdminStatusAndMobile: Error fetching leaders:', error);
      return { admin: null, state: normalizedState, mobile: null, leader: null };
    }

    const match = matchedLeaders && matchedLeaders.length > 0 ? matchedLeaders[0] : null;

    if (match) {
      return {
        admin: match.admin || null,
        state: (match.state || normalizedState).toUpperCase().trim(),
        mobile: match.mobile || null,
        leader: match.leader || null,
      };
    }

    return { admin: null, state: normalizedState, mobile: null, leader: null };
  } catch (error) {
    console.error('Error getting user admin status and mobile:', error);
    return { admin: null, state: null, mobile: null, leader: null };
  }
}

