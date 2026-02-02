import { supabase } from './supabaseClient';

export interface User {
  id: string;
  email?: string;
}

export interface StateLeaderMatch {
  id: string;
  state: string;
  leader: string;
  mobile: string | null;
  admin: string | null;
}

/**
 * Normalize mobile number by removing spaces, dashes, parentheses, and other formatting
 * Handles country codes (e.g., +61) and Australian mobile numbers
 * For Australian numbers: 
 *   - +61 0429028464 -> 0429028464 (removes country code, keeps leading 0)
 *   - +61 429028464 -> 0429028464 (removes country code, adds leading 0)
 *   - +61429028464 -> 0429028464 (removes country code, adds leading 0)
 * Also handles: 0429028464, 0429 028 464, etc.
 */
export function normalizeMobile(mobile: string): string {
  if (!mobile) return '';
  
  let normalized = mobile.trim();
  
  // Handle country code +61 (Australia) - can have space or no space
  if (normalized.startsWith('+61')) {
    normalized = normalized.substring(3).trim(); // Remove '+61' and any following space
  }
  
  // Remove all non-digit characters (spaces, dashes, parentheses, + signs)
  normalized = normalized.replace(/[\s\-\(\)\+]/g, '');
  
  // For Australian numbers: if it doesn't start with 0 and has 9 digits, add leading 0
  // This handles cases like "+61 429028464" -> "429028464" -> "0429028464"
  if (normalized && !normalized.startsWith('0') && normalized.length === 9) {
    normalized = '0' + normalized;
  }
  
  return normalized;
}

/**
 * Normalize name by trimming whitespace and converting to lowercase for comparison
 * Returns the normalized version for comparison, but we'll use the original for display
 */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Validate mobile number and first name against state_leaders table
 * Handles mobile number formatting variations (spaces, dashes, etc.)
 * Handles name case variations (case-insensitive matching)
 * Returns the matching record if found, null otherwise
 */
export async function validateStateLeader(mobile: string, firstName: string): Promise<StateLeaderMatch | null> {
  const mobileNormalized = normalizeMobile(mobile);
  const firstNameNormalized = normalizeName(firstName);
  
  if (!mobileNormalized || !firstNameNormalized) {
    return null;
  }

  // Fetch all state_leaders records to do case-insensitive and mobile normalization matching
  // We need to do this because:
  // 1. Mobile numbers in DB might have spaces/formatting we need to normalize
  // 2. Name matching needs to be case-insensitive
  const { data, error } = await supabase
    .from('state_leaders')
    .select('id, state, leader, mobile, admin');

  if (error) {
    console.error('Error validating state leader:', error);
    throw error;
  }

  if (!data || data.length === 0) {
    return null;
  }

  // Find matching record with normalized comparison
  const match = data.find(record => {
    if (!record.mobile) return false;
    
    // Normalize mobile numbers for comparison
    const recordMobileNormalized = normalizeMobile(record.mobile);
    const recordNameNormalized = normalizeName(record.leader);
    
    return recordMobileNormalized === mobileNormalized && 
           recordNameNormalized === firstNameNormalized;
  });

  return match || null;
}

/**
 * Sign in with mobile and first name validation
 * Creates an anonymous session after validation
 */
export async function signInWithMobileAndName(mobile: string, firstName: string): Promise<{ user: any; stateLeader: StateLeaderMatch }> {
  // First validate against state_leaders table
  const stateLeader = await validateStateLeader(mobile, firstName);
  
  if (!stateLeader) {
    throw new Error('No matching record found. Please check your mobile number and first name.');
  }

  // Sign in anonymously to create a session
  const { data: authData, error: authError } = await supabase.auth.signInAnonymously();
  
  if (authError) {
    throw new Error(`Authentication failed: ${authError.message}`);
  }

  if (!authData.user) {
    throw new Error('Failed to create user session');
  }

  // Store mobile and first name in user_profiles
  const { error: profileError } = await supabase
    .from('user_profiles')
    .upsert({
      user_id: authData.user.id,
      name: firstName.trim(),
      state: stateLeader.state,
    }, {
      onConflict: 'user_id'
    });

  if (profileError) {
    console.warn('Failed to save user profile:', profileError);
    // Don't throw - authentication succeeded, profile is optional
  }

  // Only grant admin role if admin field is exactly 'AD' (not 'SR' or other values)
  if (stateLeader.admin === 'AD') {
    const { error: roleError } = await supabase
      .from('user_roles')
      .upsert({
        user_id: authData.user.id,
        role: 'admin',
      }, {
        onConflict: 'user_id'
      });

    if (roleError) {
      console.warn('Failed to grant admin role:', roleError);
      // Don't throw - authentication succeeded, role assignment can be retried
    }
  }

  // Record last sign-in for this leader (used to find leaders not signed in since weekly refresh)
  const { error: signInUpdateError } = await supabase
    .from('state_leaders')
    .update({ last_sign_in_at: new Date().toISOString() })
    .eq('id', stateLeader.id);

  if (signInUpdateError) {
    console.warn('Failed to update last_sign_in_at:', signInUpdateError);
  }

  return {
    user: authData.user,
    stateLeader,
  };
}

export async function sendMagicLink(email: string) {
  // Get the current origin (localhost:3000 in development)
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  
  const { data, error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser(): Promise<User | null> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  return user ? { id: user.id, email: user.email } : null;
}

export async function getSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  return session;
}

/**
 * Sign in anonymously (for development when email is not working)
 */
export async function signInAnonymously() {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data;
}


