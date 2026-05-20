import { supabase } from '@/lib/supabaseClient';
import { logCampaignChange } from '@/lib/campaignLog';
import type { Campaign } from '@/lib/types';

export interface NewCampaignData {
  date: string;
  state: string;
  place: string;
  time: string;
  leader: string;
  mobile: string | null;
  category: string;
  tl_ok?: boolean;
  sr_ok?: boolean;
  user_id: string;
  source?: string;
}

export interface CampaignsByDateRangeOptions {
  startDate: string;
  endDate: string;
  state?: string;
}

/** Fetch a single campaign by id. Returns null if not found. */
export async function getCampaignById(id: string): Promise<Campaign | null> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    throw error;
  }
  return data as Campaign;
}

/** Create a new campaign and log the insertion. Returns the created campaign. */
export async function createCampaign(input: NewCampaignData): Promise<Campaign> {
  const { data, error } = await supabase
    .from('campaigns')
    .insert([{ ...input, created_at: new Date().toISOString() }])
    .select()
    .single();

  if (error) throw error;

  logCampaignChange(data.id, 'INSERT', null, data);
  return data as Campaign;
}

/** Update campaign fields and log the change. Returns the updated campaign. */
export async function updateCampaign(
  id: string,
  updates: Partial<Omit<Campaign, 'id' | 'created_at'>>,
  oldData?: Partial<Campaign> | null
): Promise<Campaign> {
  const { data, error } = await supabase
    .from('campaigns')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  logCampaignChange(id, 'UPDATE', oldData ?? null, data);
  return data as Campaign;
}

/** Delete a campaign by id and log the deletion. */
export async function deleteCampaign(id: string, oldData?: Partial<Campaign> | null): Promise<void> {
  const { error } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', id);

  if (error) throw error;

  logCampaignChange(id, 'DELETE', oldData ?? null, null);
}

/** Fetch campaigns within a date range, with optional state filter. */
export async function getCampaignsByDateRange(
  options: CampaignsByDateRangeOptions
): Promise<Campaign[]> {
  let query = supabase
    .from('campaigns')
    .select('*')
    .gte('date', options.startDate)
    .lte('date', options.endDate)
    .order('date', { ascending: true });

  if (options.state) {
    query = query.eq('state', options.state.trim().toUpperCase());
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as Campaign[];
}

/**
 * Find an existing campaign by its natural key (date + state + place + time + leader).
 * Returns null if not found.
 */
export async function findCampaign(criteria: {
  date: string;
  state: string;
  place: string;
  time: string;
  leader: string;
}): Promise<Campaign | null> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('date', criteria.date)
    .eq('state', criteria.state)
    .eq('place', criteria.place)
    .eq('time', criteria.time)
    .eq('leader', criteria.leader)
    .maybeSingle();

  if (error) throw error;
  return data as Campaign | null;
}
