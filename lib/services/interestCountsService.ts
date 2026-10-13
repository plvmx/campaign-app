import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * How many members registered interest per campaign — numbers only, no names
 * or contact details. Members' details (campaign_interest / training_interest
 * rows) can only be read by a session that passed 2FA, but leaders still need
 * the *count* without 2FA: for the "N people interested" note on a campaign
 * and to know whether the "Manage my Campaign Interest" button should show
 * (which is what leads them to set 2FA up).
 *
 * Visibility is decided by the caller's OWN session, not by us: `userClient`
 * is a Supabase client carrying the caller's JWT, so reading `campaigns`
 * through it returns only campaigns that person may see (own, shared, or all
 * for an admin) — the same RLS the rest of the app relies on. Only for those
 * campaigns does `adminClient` (service role, which bypasses the 2FA-gated
 * policy) count rows. Injected clients, like backupService.ts.
 */
export const MAX_CAMPAIGN_IDS = 500;

export interface InterestCounts {
  campaignInterest: Record<string, number>;
  trainingInterest: Record<string, number>;
}

async function countByCampaign(
  adminClient: SupabaseClient,
  table: 'campaign_interest' | 'training_interest',
  campaignIds: string[],
): Promise<Record<string, number>> {
  if (campaignIds.length === 0) return {};
  const { data, error } = await adminClient.from(table).select('campaign_id').in('campaign_id', campaignIds);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { campaign_id: string }[]) {
    counts[row.campaign_id] = (counts[row.campaign_id] ?? 0) + 1;
  }
  return counts;
}

export async function getVisibleInterestCounts(
  userClient: SupabaseClient,
  adminClient: SupabaseClient,
  requestedIds: string[],
): Promise<InterestCounts> {
  const ids = [...new Set(requestedIds)].slice(0, MAX_CAMPAIGN_IDS);
  if (ids.length === 0) return { campaignInterest: {}, trainingInterest: {} };

  const { data, error } = await userClient.from('campaigns').select('id').in('id', ids);
  if (error) throw error;
  const visibleIds = ((data ?? []) as { id: string }[]).map((c) => c.id);

  const [campaignInterest, trainingInterest] = await Promise.all([
    countByCampaign(adminClient, 'campaign_interest', visibleIds),
    countByCampaign(adminClient, 'training_interest', visibleIds),
  ]);
  return { campaignInterest, trainingInterest };
}
