/**
 * Who may record results for a campaign — the single rule behind both the
 * green "Record Results" button (app/app/components/CampaignCard.tsx) and the
 * server checks on the campaign report routes (`/api/leader/campaign-report`),
 * so the two can't drift apart. Pure: no database access.
 *
 *  - a full admin (AD): any campaign;
 *  - a state reporter (SR): campaigns in their own state;
 *  - anyone else: a campaign that is their own (same leader name and mobile —
 *    deliberately not state: one person can hold rows in several states, and
 *    the main feed already matches their campaigns by name + mobile, so the
 *    button must too) or that another leader has shared with them.
 *
 * Whether the campaign is in the past is a separate, client-side check — it
 * depends on the viewer's local clock, so the server does not enforce it.
 */
import type { LeaderShareOwner } from '@/lib/types';
import { normalizeMobile, normalizeName } from '@/lib/auth';

export interface RecordResultsCaller {
  adminStatus: string | null;
  state: string | null;
  leader: string | null;
  mobile: string | null;
}

const sameState = (a: string | null | undefined, b: string | null | undefined) =>
  (a || '').toUpperCase().trim() === (b || '').toUpperCase().trim();

export function canRecordResultsFor(
  campaign: { state: string; leader: string; mobile: string | null },
  caller: RecordResultsCaller,
  sharedWithMeOwners: LeaderShareOwner[],
): boolean {
  if (caller.adminStatus === 'AD') return true;
  if (caller.adminStatus === 'SR') return sameState(campaign.state, caller.state);

  const isOwn =
    !!caller.leader &&
    normalizeName(campaign.leader || '') === normalizeName(caller.leader) &&
    !!caller.mobile &&
    normalizeMobile(campaign.mobile || '') === normalizeMobile(caller.mobile);
  const isShared = sharedWithMeOwners.some(
    (o) => sameState(o.owner_state, campaign.state) && normalizeName(o.owner_leader) === normalizeName(campaign.leader || ''),
  );
  return isOwn || isShared;
}
