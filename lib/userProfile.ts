import { supabase } from './supabaseClient';
import { getCurrentUser } from './auth';

export interface UserProfile {
  id: string;
  user_id: string;
  name: string | null;
  state: string | null;
  regular_place: string | null;
  regular_time: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Get the current user's profile
 */
export async function getUserProfile(): Promise<UserProfile | null> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return null;
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (error) {
      // If profile doesn't exist, return null (not an error)
      if (error.code === 'PGRST116') {
        return null;
      }
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return null;
  }
}

/**
 * Create or update the current user's profile
 */
export async function upsertUserProfile(profile: {
  name?: string | null;
  state?: string | null;
  regular_place?: string | null;
  regular_time?: string | null;
}): Promise<UserProfile> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .upsert(
      {
        user_id: user.id,
        name: profile.name || null,
        state: profile.state || null,
        regular_place: profile.regular_place || null,
        regular_time: profile.regular_time || null,
      },
      {
        onConflict: 'user_id',
      }
    )
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Update specific fields in the user's profile
 */
export async function updateUserProfile(
  updates: Partial<{
    name: string | null;
    state: string | null;
    regular_place: string | null;
    regular_time: string | null;
  }>
): Promise<UserProfile> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .update(updates)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

