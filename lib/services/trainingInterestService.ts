/**
 * training_interest — members expressing interest in joining a training
 * session (a campaign with category BOTJ or TLT) via its per-campaign public
 * link (/public/training/[campaignId]). One row per (campaign, person). See
 * scripts/create_training_interest_table.sql.
 *
 * Note: these functions use the browser client, which is RLS-gated to the
 * campaign's owning/shared leader or an admin (see supabase/rls-policies.sql)
 * — so only the leader-facing /training-interest screens use it. The public
 * submission flow can't (anonymous visitors have no RLS access) — it inserts
 * via the service role directly in
 * app/api/public/training-interest/[campaignId]/route.ts instead.
 */
import { supabase } from '@/lib/supabaseClient';
import type { Campaign } from '@/lib/types';
import { getCampaignsForUser, type CampaignsForUserParams } from './campaignService';

/**
 * Campaign category codes that represent a training session. Deliberately a
 * hardcoded allowlist rather than reading from the DB-driven
 * `campaign_categories` table (see /admin/campaign-categories): "is this
 * category a training" is a property of the code itself, not something an
 * admin currently has a way to flag per-category in that table. If a new
 * training-style category is introduced later, it needs adding here too —
 * consider adding an `is_training` boolean column to `campaign_categories`
 * instead if this list grows past BOTJ/TLT.
 */
export const TRAINING_CATEGORIES = ['BOTJ', 'TLT'] as const;
export type TrainingCategory = (typeof TRAINING_CATEGORIES)[number];

export function isTrainingCategory(category: string | null | undefined): boolean {
  return !!category && (TRAINING_CATEGORIES as readonly string[]).includes(category);
}

export interface TrainingInterest {
  id: string;
  campaign_id: string;
  name: string;
  mobile: string | null;
  email: string | null;
  contacted: boolean;
  contacted_at: string | null;
  created_at: string;
}

/**
 * Training campaigns (category BOTJ/TLT) visible to the current user —
 * reuses getCampaignsForUser's role-aware fetch (own + shared + admin) rather
 * than re-implementing that filtering here, then narrows to training
 * categories client-side.
 */
export async function getTrainingCampaigns(params: CampaignsForUserParams): Promise<Campaign[]> {
  const { campaigns } = await getCampaignsForUser(params);
  return campaigns.filter((c) => isTrainingCategory(c.category));
}

/** Count of training_interest rows per campaign id, for the given campaign ids. */
export async function getTrainingInterestCounts(campaignIds: string[]): Promise<Map<string, number>> {
  if (campaignIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('training_interest')
    .select('campaign_id')
    .in('campaign_id', campaignIds);
  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of (data || []) as { campaign_id: string }[]) {
    counts.set(row.campaign_id, (counts.get(row.campaign_id) ?? 0) + 1);
  }
  return counts;
}

/** All interest registrations for one training campaign, newest first. */
export async function getTrainingInterestForCampaign(campaignId: string): Promise<TrainingInterest[]> {
  const { data, error } = await supabase
    .from('training_interest')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as TrainingInterest[];
}

/**
 * Mark a registration as contacted (or un-contacted). `contacted_at` is set
 * to now when marking contacted, and cleared back to null when un-marking.
 * Returns the updated row's contacted_at so callers can update local state
 * from the authoritative persisted value rather than re-deriving their own
 * timestamp with a second `new Date().toISOString()` call.
 */
export async function setTrainingInterestContacted(id: string, contacted: boolean): Promise<{ contacted_at: string | null }> {
  const { data, error } = await supabase
    .from('training_interest')
    .update({ contacted, contacted_at: contacted ? new Date().toISOString() : null })
    .eq('id', id)
    .select('contacted_at')
    .single();
  if (error) throw error;
  return data as { contacted_at: string | null };
}
