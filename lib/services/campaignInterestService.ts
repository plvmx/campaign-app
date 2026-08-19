/**
 * campaign_interest — members registering interest in joining a campaign via
 * the public Register Interest screen (app/public/register-interest). One
 * row per (campaign, person) pair. See scripts/create_campaign_interest_table.sql.
 *
 * Note: this module's functions use the browser client, which is RLS-gated
 * to an admin or the campaign's owning/shared leader for this table (see
 * supabase/rls-policies.sql) — so it's used by both /admin/registered-interest
 * (getCampaignInterestList, admin-wide) and the leader-facing /campaign-interest
 * (getCampaignInterestForLeader). The public submission flow can't use it
 * (anonymous visitors have no RLS access) — it inserts via the service role
 * directly in app/api/public/register-interest/route.ts instead.
 */
import { supabase } from '@/lib/supabaseClient';
import type { Campaign } from '@/lib/types';
import { getCampaignsForUser, type CampaignsForUserParams } from './campaignService';

export type CampaignInterestType = 'in' | 'more';

export interface CampaignInterest {
  id: string;
  campaign_id: string;
  first_name: string;
  mobile: string;
  interest_type: CampaignInterestType;
  contacted: boolean;
  contacted_at: string | null;
  created_at: string;
}

/** The subset of campaign fields needed to identify/display which campaign an interest row is for. */
export type CampaignInterestCampaignInfo = Pick<Campaign, 'id' | 'date' | 'state' | 'place' | 'site' | 'time' | 'leader'>;

export interface CampaignInterestWithCampaign extends CampaignInterest {
  /** Null if the referenced campaign has since been deleted independently of this row (shouldn't normally happen — FK is ON DELETE CASCADE). */
  campaign: CampaignInterestCampaignInfo | null;
}

/**
 * All campaign interest registrations, newest first, each paired with its
 * campaign's key details. Fetched as two queries (rather than a PostgREST
 * embed) to keep the relationship explicit and easy to mock in tests.
 */
export async function getCampaignInterestList(): Promise<CampaignInterestWithCampaign[]> {
  const { data, error } = await supabase
    .from('campaign_interest')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const entries = (data || []) as CampaignInterest[];
  if (entries.length === 0) return [];

  const campaignIds = [...new Set(entries.map(e => e.campaign_id))];
  const { data: campaignRows, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, date, state, place, site, time, leader')
    .in('id', campaignIds);
  if (campaignError) throw campaignError;

  const campaignsById = new Map(
    (campaignRows || []).map(c => [c.id as string, c as CampaignInterestCampaignInfo]),
  );

  return entries.map(e => ({ ...e, campaign: campaignsById.get(e.campaign_id) ?? null }));
}

/**
 * Interest registrations for campaigns the given user leads (own, shared, or
 * — for admins — every campaign) — reuses getCampaignsForUser's role-aware
 * fetch rather than re-implementing that filtering here, same pattern as
 * trainingInterestService's getTrainingCampaigns. Unlike getCampaignInterestList
 * (admin-wide, needs a second campaigns query), the campaign details are
 * already in hand from getCampaignsForUser's own result.
 */
export async function getCampaignInterestForLeader(params: CampaignsForUserParams): Promise<CampaignInterestWithCampaign[]> {
  const { campaigns } = await getCampaignsForUser(params);
  if (campaigns.length === 0) return [];

  const campaignIds = campaigns.map(c => c.id);
  const { data, error } = await supabase
    .from('campaign_interest')
    .select('*')
    .in('campaign_id', campaignIds)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const campaignsById = new Map(campaigns.map(c => [c.id, c as CampaignInterestCampaignInfo]));

  return ((data || []) as CampaignInterest[]).map(e => ({ ...e, campaign: campaignsById.get(e.campaign_id) ?? null }));
}

/**
 * Mark a registration as contacted (or un-contacted). `contacted_at` is set
 * to now when marking contacted, and cleared back to null when un-marking.
 * Returns the updated row's contacted_at so callers can update local state
 * from the authoritative persisted value rather than re-deriving their own
 * timestamp with a second `new Date().toISOString()` call.
 */
export async function setCampaignInterestContacted(id: string, contacted: boolean): Promise<{ contacted_at: string | null }> {
  const { data, error } = await supabase
    .from('campaign_interest')
    .update({ contacted, contacted_at: contacted ? new Date().toISOString() : null })
    .eq('id', id)
    .select('contacted_at')
    .single();
  if (error) throw error;
  return data as { contacted_at: string | null };
}
