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
 * Validate mobile number and first name against state_leaders table.
 * Returns ALL matching records — callers must handle the multi-state case.
 * Uses server-side API route with service role to bypass RLS.
 */
export async function validateStateLeader(mobile: string, firstName: string): Promise<StateLeaderMatch[]> {
  try {
    const res = await fetch('/api/auth/validate-leader', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile, firstName }),
    });

    const json = await res.json();

    if (!res.ok) {
      console.error('Error validating state leader:', json.error);
      throw new Error(json.error || 'Validation failed');
    }

    return (json.matches ?? []).map((m: StateLeaderMatch) => ({
      id:     m.id,
      state:  m.state,
      leader: m.leader,
      mobile: null,
      admin:  m.admin,
    }));
  } catch (err) {
    console.error('Error validating state leader:', err);
    throw err;
  }
}

/**
 * Complete sign-in once a specific state_leaders record has been chosen.
 * Creates an anonymous Supabase session and writes user_profiles / user_roles.
 */
export async function completeSignIn(
  stateLeader: StateLeaderMatch,
): Promise<{ user: User; stateLeader: StateLeaderMatch }> {
  // Sign out any existing stale session first. Without this, every login on the
  // same device creates a fresh anonymous auth user that is never cleaned up.
  const { data: { session: existingSession } } = await supabase.auth.getSession();
  if (existingSession) {
    await supabase.auth.signOut();
  }

  const { data: authData, error: authError } = await supabase.auth.signInAnonymously();

  if (authError) {
    const msg = authError.message || authError.toString();
    throw new Error(
      msg.includes('Anonymous sign-ins are disabled')
        ? 'Anonymous sign-in is disabled in Supabase. Enable it in Dashboard → Authentication → Providers → Anonymous.'
        : `Authentication failed: ${msg}`
    );
  }

  if (!authData.user) {
    throw new Error('Failed to create user session');
  }

  // Store name + active state in user_profiles
  const { error: profileError } = await supabase
    .from('user_profiles')
    .upsert(
      { user_id: authData.user.id, name: stateLeader.leader.trim(), state: stateLeader.state },
      { onConflict: 'user_id' },
    );
  if (profileError) console.warn('Failed to save user profile:', profileError);

  // Grant admin role only for full admins (not SR)
  if (stateLeader.admin === 'AD') {
    const { error: roleError } = await supabase
      .from('user_roles')
      .upsert({ user_id: authData.user.id, role: 'admin' }, { onConflict: 'user_id' });
    if (roleError) console.warn('Failed to grant admin role:', roleError);
  }

  // Record sign-in timestamp
  const { error: signInUpdateError } = await supabase
    .from('state_leaders')
    .update({ last_sign_in_at: new Date().toISOString() })
    .eq('id', stateLeader.id);
  if (signInUpdateError) console.warn('Failed to update last_sign_in_at:', signInUpdateError);

  // Set a session-indicator cookie so Next.js middleware can redirect
  // unauthenticated requests before they reach protected pages. This cookie is
  // not cryptographically verified — RLS remains the true security boundary.
  if (typeof document !== 'undefined') {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `app_session=1; path=/; SameSite=Lax${secure}`;
  }

  return { user: { id: authData.user.id, email: authData.user.email }, stateLeader };
}

/**
 * Convenience wrapper: validate then sign in immediately.
 * Errors if credentials are invalid; picks the first record if multiple states
 * match (legacy behaviour — prefer validateStateLeader + completeSignIn for
 * full multi-state support).
 */
export async function signInWithMobileAndName(
  mobile: string,
  firstName: string,
): Promise<{ user: User; stateLeader: StateLeaderMatch }> {
  const matches = await validateStateLeader(mobile, firstName);
  if (matches.length === 0) {
    throw new Error('No matching record found. Please check your mobile number and first name.');
  }
  return completeSignIn(matches[0]);
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
  // Clear the session-indicator cookie set on login.
  if (typeof document !== 'undefined') {
    document.cookie = 'app_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
  }
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


