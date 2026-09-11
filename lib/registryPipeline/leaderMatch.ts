// Cross-references registry.registrants against public.state_leaders by
// normalized phone number — the only field both systems reliably collect
// (state_leaders has no email column at all; login there is mobile+name —
// see lib/auth.ts). Name matching isn't used: state_leaders.leader is one
// combined free-text field while registry.registrants splits first/last,
// so it's exactly the kind of fuzzy comparison that produces false
// positives/negatives. Kept pure/framework-free, same precedent as the
// rest of lib/registryPipeline/ — see app/api/registry/manage-summary/route.ts
// for where this actually runs (a live join on every request, not a
// stored/synced column — see that file's header comment for why).
import { normalizePhone } from './phone';

/** Just enough of a state_leaders row to match against — state_leaders.mobile is in the main app's local '0XXXXXXXXX' format, normalized here the same way registry.registrants.phone already is. */
export interface LeaderForMatch {
  leader: string;
  mobile: string | null;
  state: string;
}

export interface LeaderMatch {
  leaderName: string;
  leaderState: string;
}

/**
 * One normalized phone -> leader. If two leader rows somehow share a phone
 * (state_leaders has no uniqueness constraint on mobile alone), the later
 * one in the input array wins — an edge case not worth failing over, since
 * this is an informational cross-reference, not an identity system.
 */
export function buildLeaderPhoneIndex(leaders: LeaderForMatch[]): Map<string, LeaderForMatch> {
  const index = new Map<string, LeaderForMatch>();
  for (const leader of leaders) {
    const phone = normalizePhone(leader.mobile);
    if (phone) index.set(phone, leader);
  }
  return index;
}

export function findMatchingLeader(registrantPhone: string | null, index: Map<string, LeaderForMatch>): LeaderMatch | null {
  const phone = normalizePhone(registrantPhone);
  if (!phone) return null;
  const leader = index.get(phone);
  return leader ? { leaderName: leader.leader, leaderState: leader.state } : null;
}

/** Convenience entry point: tags every registrant with whether (and which) state_leaders row matches its phone. Generic over T so callers get back their own richer row type, same pattern as registrantCounts.ts's filterRegistrantsForCell. */
export function matchRegistrantsToLeaders<T extends { phone: string | null }>(
  registrants: T[],
  leaders: LeaderForMatch[],
): (T & { isLeader: boolean; leaderName: string | null; leaderState: string | null })[] {
  const index = buildLeaderPhoneIndex(leaders);
  return registrants.map((registrant) => {
    const match = findMatchingLeader(registrant.phone, index);
    return { ...registrant, isLeader: !!match, leaderName: match?.leaderName ?? null, leaderState: match?.leaderState ?? null };
  });
}
