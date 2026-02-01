import { supabase } from './supabaseClient';
import { normalizeName, normalizeMobile } from './auth';

export interface LeaderShareOwner {
  owner_state: string;
  owner_leader: string;
}

/**
 * Get the list of (owner_state, owner_leader) who have shared their campaigns with the given leader.
 * Use this to load "shared with me" campaigns: campaigns where (state, leader) is in this list.
 */
export async function getSharedWithMeOwners(
  myState: string,
  myLeader: string
): Promise<LeaderShareOwner[]> {
  if (!myState?.trim() || !myLeader?.trim()) return [];
  const normalizedState = myState.toUpperCase().trim();
  const myLeaderNorm = normalizeName(myLeader);
  const { data, error } = await supabase
    .from('leader_shares')
    .select('owner_state, owner_leader, shared_with_leader')
    .eq('shared_with_state', normalizedState);

  if (error) {
    console.error('getSharedWithMeOwners:', error);
    return [];
  }
  return (data || [])
    .filter((r) => normalizeName(r.shared_with_leader || '') === myLeaderNorm)
    .map((r) => ({
      owner_state: r.owner_state,
      owner_leader: r.owner_leader,
    }));
}

/**
 * Check if the current user (myState, myLeader, myMobile) can access a campaign
 * (campaignState, campaignLeader, campaignMobile). Returns true if:
 * - Own: campaign leader/state/mobile match mine, or
 * - Shared: the campaign's (state, leader) is an owner who shared with me.
 */
export async function canAccessCampaign(
  campaignState: string,
  campaignLeader: string,
  campaignMobile: string | null,
  myState: string | null,
  myLeader: string | null,
  myMobile: string | null
): Promise<boolean> {
  if (!myState?.trim() || !myLeader?.trim()) return false;

  const myStateNorm = myState.toUpperCase().trim();
  const campaignStateNorm = (campaignState || '').toUpperCase().trim();
  const myLeaderNorm = normalizeName(myLeader);
  const campaignLeaderNorm = normalizeName(campaignLeader || '');

  // Own: same state, same leader, same mobile
  if (campaignStateNorm === myStateNorm && campaignLeaderNorm === myLeaderNorm) {
    if (myMobile) {
      const campaignMobileNorm = normalizeMobile(campaignMobile || '');
      const myMobileNorm = normalizeMobile(myMobile);
      if (campaignMobileNorm && campaignMobileNorm === myMobileNorm) return true;
    }
    // If no mobile on campaign or we don't have mobile, still allow if state+leader match (owner)
    if (!campaignMobile?.trim() || !myMobile?.trim()) return true;
  }

  // Shared: campaign's (state, leader) has shared with me
  const owners = await getSharedWithMeOwners(myState, myLeader);
  const isShared =
    owners.some(
      (o) =>
        (o.owner_state || '').toUpperCase().trim() === campaignStateNorm &&
        normalizeName(o.owner_leader) === campaignLeaderNorm
    );
  return isShared;
}

/**
 * Sync check: is this campaign owned by the current user (leader + mobile match)?
 * Use for Delete button (only owner can delete). Shared users can view/edit/record results but not delete.
 */
export function isCampaignOwner(
  campaignLeader: string,
  campaignMobile: string | null,
  myLeader: string | null,
  myMobile: string | null
): boolean {
  if (!myLeader?.trim()) return false;
  const leaderMatch = normalizeName(campaignLeader || '') === normalizeName(myLeader);
  if (!leaderMatch) return false;
  if (!myMobile?.trim()) return true;
  return (
    normalizeMobile(campaignMobile || '') === normalizeMobile(myMobile) &&
    normalizeMobile(campaignMobile || '') !== ''
  );
}
