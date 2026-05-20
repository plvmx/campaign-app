import { supabase } from '@/lib/supabaseClient';

/**
 * Fetch the sorted list of places for a given state.
 * Single source of truth — replaces ~10 identical inline queries across the codebase.
 */
export async function getPlacesForState(state: string): Promise<string[]> {
  if (!state) return [];

  const normalizedState = state.trim().toUpperCase();

  const { data, error } = await supabase
    .from('state_places')
    .select('place')
    .eq('state', normalizedState)
    .order('place', { ascending: true });

  if (error) {
    console.error('getPlacesForState error:', error);
    return [];
  }

  return Array.from(
    new Set((data || []).map((r) => r.place).filter(Boolean))
  ).sort() as string[];
}

/**
 * Fetch the mobile number for a specific leader in a state.
 * Returns null if not found.
 */
export async function getLeaderMobile(state: string, leader: string): Promise<string | null> {
  if (!state || !leader) return null;

  const { data, error } = await supabase
    .from('state_leaders')
    .select('mobile')
    .eq('state', state.trim().toUpperCase())
    .eq('leader', leader)
    .single();

  if (error || !data) return null;
  return data.mobile ?? null;
}

/**
 * Fetch the list of campaign categories from the campaign_categories table.
 * Returns [{code, name}] ordered by code. Falls back to an empty array on error.
 */
export async function getCampaignCategories(): Promise<{ code: string; name: string }[]> {
  const { data, error } = await supabase
    .from('campaign_categories')
    .select('code, name')
    .order('code', { ascending: true });

  if (error) {
    console.error('getCampaignCategories error:', error);
    return [];
  }

  return (data ?? []) as { code: string; name: string }[];
}

/**
 * Fetch the sorted list of leader names for a given state.
 * Single source of truth — replaces ~5 identical inline queries across the codebase.
 */
export async function getLeadersForState(state: string): Promise<string[]> {
  if (!state) return [];

  const normalizedState = state.trim().toUpperCase();

  const { data, error } = await supabase
    .from('state_leaders')
    .select('leader')
    .eq('state', normalizedState)
    .order('leader', { ascending: true });

  if (error) {
    console.error('getLeadersForState error:', error);
    return [];
  }

  return Array.from(
    new Set((data || []).map((r) => r.leader).filter(Boolean))
  ).sort() as string[];
}
