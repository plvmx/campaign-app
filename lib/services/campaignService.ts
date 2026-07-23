import { supabase } from '@/lib/supabaseClient';
import { logCampaignChange } from '@/lib/campaignLog';
import { normalizeMobile, normalizeName } from '@/lib/auth';
import { getSharedWithMeOwners } from '@/lib/leaderShares';
import { excludeDateForDeletedCampaign } from '@/lib/services/rulesService';
import type { Campaign, LeaderShareOwner } from '@/lib/types';

export interface NewCampaignData {
  date: string;
  state: string;
  place: string;
  site: string;
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

/** Trim string fields that must never carry leading/trailing whitespace. */
function trimCampaignStrings<T extends { leader?: string | null; place?: string | null; site?: string | null; state?: string | null }>(input: T): T {
  return {
    ...input,
    ...(typeof input.leader === 'string' && { leader: input.leader.trim() }),
    ...(typeof input.place  === 'string' && { place:  input.place.trim()  }),
    ...(typeof input.site   === 'string' && { site:   input.site.trim()   }),
    ...(typeof input.state  === 'string' && { state:  input.state.trim()  }),
  };
}

/** Create a new campaign and log the insertion. Returns the created campaign. */
export async function createCampaign(input: NewCampaignData): Promise<Campaign> {
  const normalized = trimCampaignStrings(input);
  if (!normalized.leader) throw new Error('Leader is required');

  const { data, error } = await supabase
    .from('campaigns')
    .insert([{ ...normalized, created_at: new Date().toISOString() }])
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
  const normalized = trimCampaignStrings(updates);
  // Only enforce when this update actually touches `leader` — partial updates
  // to unrelated fields (tl_ok, actual_leader, team_size, etc.) don't include it.
  if ('leader' in normalized && !normalized.leader) throw new Error('Leader is required');

  const { data, error } = await supabase
    .from('campaigns')
    .update(normalized)
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

  // Rule-generated campaign: record the exception so the next weekly refresh doesn't
  // silently recreate what was just deleted (its dedup only checks whether a matching
  // row currently exists — see #93).
  if (
    oldData?.source === 'RUL' &&
    oldData.date && oldData.state && oldData.place && oldData.site != null &&
    oldData.time && oldData.leader
  ) {
    excludeDateForDeletedCampaign({
      date: oldData.date,
      state: oldData.state,
      place: oldData.place,
      site: oldData.site,
      time: oldData.time,
      leader: oldData.leader,
    });
  }
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
 * Find an existing campaign by its natural key (date + state + place + site + time + leader).
 * Returns null if not found.
 */
export async function findCampaign(criteria: {
  date: string;
  state: string;
  place: string;
  site: string;
  time: string;
  leader: string;
}): Promise<Campaign | null> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('date', criteria.date)
    .eq('state', criteria.state)
    .eq('place', criteria.place)
    .eq('site', criteria.site)
    .eq('time', criteria.time)
    .eq('leader', criteria.leader)
    .maybeSingle();

  if (error) throw error;
  return data as Campaign | null;
}

/**
 * Fetch TWOL campaigns led by the given leader in the past 24 hours.
 * Returns them ordered earliest first (by date ASC, time ASC).
 * Matches both explicit 'TWOL' category and legacy null-category rows.
 */
export async function getRecentTWOLCampaignsForLeader(
  leaderName: string,
): Promise<Pick<Campaign, 'id' | 'date' | 'state' | 'place' | 'site' | 'time' | 'leader'>[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const yesterdayDate = sevenDaysAgo.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('campaigns')
    .select('id, date, state, place, site, time, leader')
    .ilike('leader', leaderName.trim())
    .gte('date', yesterdayDate)
    .or('category.eq.TWOL,category.is.null')
    .order('date', { ascending: true })
    .order('time', { ascending: true });

  if (error) throw error;
  return (data || []) as Pick<Campaign, 'id' | 'date' | 'state' | 'place' | 'site' | 'time' | 'leader'>[];
}

export interface CampaignsForUserParams {
  adminStatus: string | null;
  userState: string | null;
  userLeader: string | null;
  userMobile: string | null;
  userId: string;
}

export interface CampaignsForUserResult {
  campaigns: Campaign[];
  sharedOwners: LeaderShareOwner[];
}

/**
 * Fetch campaigns visible to the current user based on their role.
 * Handles admin/SR/TL filtering, shared-leader merging, and mobile-based filtering.
 */
export async function getCampaignsForUser(
  params: CampaignsForUserParams,
): Promise<CampaignsForUserResult> {
  const { adminStatus, userState, userLeader, userMobile, userId } = params;

  let sharedOwners: LeaderShareOwner[] = [];

  let query = supabase.from('campaigns').select('*');
  if (adminStatus === 'AD') {
    // no filter — see all
  } else if (adminStatus === 'SR') {
    query = userState
      ? query.eq('state', userState.toUpperCase().trim())
      : query.eq('user_id', userId);
  } else {
    if (userLeader && userState) {
      sharedOwners = await getSharedWithMeOwners(userState, userLeader);
      query = query.eq('leader', userLeader.trim());
    } else {
      query = query.eq('user_id', userId);
    }
  }

  const { data, error } = await query
    .order('date', { ascending: true })
    .order('state', { ascending: true })
    .order('place', { ascending: true })
    .order('time', { ascending: true });

  if (error) throw error;

  let merged: Campaign[] = (data || []) as Campaign[];

  if (adminStatus !== 'AD' && adminStatus !== 'SR' && sharedOwners.length > 0) {
    const sharedResults = await Promise.all(
      sharedOwners.map((o) =>
        supabase
          .from('campaigns')
          .select('*')
          .eq('state', o.owner_state || '')
          .eq('leader', (o.owner_leader || '').trim())
          .order('date', { ascending: true })
          .order('state', { ascending: true })
          .order('place', { ascending: true })
          .order('time', { ascending: true }),
      ),
    );
    const ownIds = new Set(merged.map((c) => c.id));
    for (const { data: sharedData, error: sharedError } of sharedResults) {
      if (!sharedError && sharedData?.length) {
        const extra = (sharedData as Campaign[]).filter((c) => !ownIds.has(c.id));
        extra.forEach((c) => ownIds.add(c.id));
        merged = [...merged, ...extra];
      }
    }
  }

  if (adminStatus !== 'AD' && adminStatus !== 'SR' && userMobile && userState) {
    const normalizedMobile = normalizeMobile(userMobile);
    const isSharedCampaign = (c: Campaign) =>
      sharedOwners.some(
        (o) =>
          (o.owner_state || '').toUpperCase().trim() === (c.state || '').toUpperCase().trim() &&
          normalizeName(o.owner_leader) === normalizeName(c.leader || ''),
      );
    merged = merged.filter(
      (c) =>
        isSharedCampaign(c) ||
        (!!c.mobile && normalizeMobile(c.mobile) === normalizedMobile),
    );
  }

  return { campaigns: merged, sharedOwners };
}

/**
 * Find all campaigns matching a natural key. Unlike findCampaign, this returns
 * an array because multiple campaigns can share the same key when different
 * leaders created entries with the same date/state/place/time/leader values.
 */
export async function findCampaignsByKey(criteria: {
  date: string;
  state: string;
  place: string;
  site: string;
  time: string;
  leader: string;
}): Promise<Pick<Campaign, 'id' | 'mobile' | 'state' | 'leader'>[]> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, mobile, state, leader')
    .eq('date', criteria.date)
    .eq('state', criteria.state)
    .eq('place', criteria.place)
    .eq('site', criteria.site)
    .eq('time', criteria.time)
    .eq('leader', criteria.leader);

  if (error) throw error;
  return (data || []) as Pick<Campaign, 'id' | 'mobile' | 'state' | 'leader'>[];
}
