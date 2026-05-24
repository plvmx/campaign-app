'use client';
import type { Campaign } from '@/lib/types';
import type { LeaderShareOwner } from '@/lib/types';
import { getStateColor } from '@/lib/stateColors';
import { formatCampaignTimeDisplay, isCampaignPast } from '@/lib/campaignUtils';
import { normalizeName, normalizeMobile } from '@/lib/auth';

const SOURCE_LABEL: Record<string, string> = {
  MAN: 'Manual',
  CFP: 'Copied from past week',
  RUL: 'Created by rule',
};

function canRecordResults(
  campaign: Campaign,
  adminStatus: string | null,
  userState: string | null,
  userMobileAndLeader: { mobile: string | null; leader: string | null } | null,
  sharedWithMeOwners: LeaderShareOwner[],
): boolean {
  if (!isCampaignPast(campaign.date, campaign.time)) return false;
  if (adminStatus === 'AD') return true;
  if (adminStatus === 'SR') {
    return (campaign.state || '').toUpperCase().trim() === (userState || '').toUpperCase().trim();
  }
  const isOwn =
    !!userMobileAndLeader?.leader &&
    !!userState &&
    normalizeName(campaign.leader || '') === normalizeName(userMobileAndLeader.leader) &&
    (campaign.state || '').toUpperCase().trim() === userState.toUpperCase().trim() &&
    !!userMobileAndLeader.mobile &&
    normalizeMobile(campaign.mobile || '') === normalizeMobile(userMobileAndLeader.mobile);
  const isShared = sharedWithMeOwners.some(
    (o) =>
      (o.owner_state || '').toUpperCase().trim() === (campaign.state || '').toUpperCase().trim() &&
      normalizeName(o.owner_leader) === normalizeName(campaign.leader || ''),
  );
  return isOwn || isShared;
}

interface Props {
  campaign: Campaign;
  dateFilter: 'past' | 'future';
  isAdmin: boolean;
  adminStatus: string | null;
  userState: string | null;
  userMobileAndLeader: { mobile: string | null; leader: string | null } | null;
  sharedWithMeOwners: LeaderShareOwner[];
  savedCheckboxId: string | null;
  onEdit: () => void;
  onDelete: () => void;
  onToggleCheckbox: (field: 'tl_ok' | 'sr_ok', currentValue: boolean) => void;
  onRecordResults: () => void;
}

export default function CampaignCard({
  campaign, dateFilter, isAdmin, adminStatus, userState, userMobileAndLeader,
  sharedWithMeOwners, savedCheckboxId, onEdit, onDelete, onToggleCheckbox, onRecordResults,
}: Props) {
  const stateColor = getStateColor(campaign.state);
  const displayTime = formatCampaignTimeDisplay(campaign.time);
  const campaignCat = campaign.category ?? 'TWOL';
  const showCategoryBadge = campaignCat !== 'TWOL';
  const showRecordResults = canRecordResults(campaign, adminStatus, userState, userMobileAndLeader, sharedWithMeOwners);

  return (
    <div className={`p-4 sm:p-5 ${stateColor.bg} border-b-2 border-gray-800 dark:border-gray-600`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className={`flex items-center justify-between gap-2 text-lg sm:text-xl font-bold ${stateColor.text} mb-2 break-words`}>
            <span>{campaign.place} {campaign.state} • {displayTime}</span>
            {showCategoryBadge && <span className="shrink-0 ml-2">{campaignCat}</span>}
          </div>
          <div className={`text-base sm:text-lg ${stateColor.text} opacity-90 mb-1 break-words`}>
            <span className="font-semibold">Leader: </span>
            <span className="font-bold">{campaign.leader}</span>
            {campaign.mobile && (
              <> <span className="font-normal">{campaign.mobile}</span></>
            )}
            {isAdmin && campaign.source && (
              <span
                className="ml-2 text-xs font-normal opacity-75"
                title={SOURCE_LABEL[campaign.source] ?? campaign.source}
              >
                ({campaign.source})
              </span>
            )}
          </div>
          {dateFilter === 'future' && (
            <div className="flex items-center gap-3 justify-center text-sm sm:text-base mt-2 mb-2">
              <div
                className={`flex items-center ${stateColor.text} font-semibold cursor-pointer`}
                onClick={() => onToggleCheckbox('tl_ok', campaign.tl_ok)}
              >
                <input
                  type="checkbox"
                  checked={campaign.tl_ok}
                  onChange={() => {}}
                  className="h-5 w-5 rounded border-gray-300 mr-2 cursor-pointer"
                />
                <span>This Campaign is Correct</span>
              </div>
              {savedCheckboxId === campaign.id && (
                <span className="text-sm font-semibold text-green-600 dark:text-green-400 animate-pulse">
                  Saved ✓
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-row gap-2 sm:ml-4 w-full sm:w-auto">
          {showRecordResults && (
            <button
              onClick={onRecordResults}
              className="flex-1 rounded-md bg-green-100 px-2 sm:px-4 py-2 text-base font-bold text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50 border-2 border-gray-800 dark:border-gray-600"
            >
              Record Results
            </button>
          )}
          <button
            onClick={onEdit}
            className="flex-1 rounded-md bg-blue-100 px-2 sm:px-4 py-2 text-base font-bold text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50 border-2 border-gray-800 dark:border-gray-600"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="flex-1 rounded-md bg-red-100 px-2 sm:px-4 py-2 text-base font-bold text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50 border-2 border-gray-800 dark:border-gray-600"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
