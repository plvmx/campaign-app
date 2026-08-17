/**
 * campaign_interest — members registering interest in joining a campaign via
 * the public Register Interest screen (app/public/register-interest). One
 * row per (campaign, person) pair. See scripts/create_campaign_interest_table.sql.
 *
 * Note: this module's functions use the browser client, which is RLS-gated
 * to admins for this table — so only the admin-only /admin/registered-interest
 * listing screen (getCampaignInterestList, setCampaignInterestContacted) uses
 * it. The public submission flow can't (anonymous visitors have no RLS
 * access) — it inserts via the service role directly in
 * app/api/public/register-interest/route.ts instead.
 */
import { supabase } from '@/lib/supabaseClient';
import type { Campaign } from '@/lib/types';

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
 * Mark a registration as contacted (or un-contacted). `contacted_at` is set
 * to now when marking contacted, and cleared back to null when un-marking.
 */
export async function setCampaignInterestContacted(id: string, contacted: boolean): Promise<void> {
  const { error } = await supabase
    .from('campaign_interest')
    .update({ contacted, contacted_at: contacted ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw error;
}
