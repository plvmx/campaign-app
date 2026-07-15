'use client';
import type { Campaign } from '@/lib/types';
import type { LeaderShareOwner } from '@/lib/types';
import type { EditUpdates } from './types';
import CampaignCard from './CampaignCard';
import InlineEditForm from './InlineEditForm';
import { combinePlaceAndSite } from '@/lib/placeSite';

interface Props {
  campaigns: Campaign[];
  editingId: string | null;
  dateFilter: 'past' | 'future';
  isAdmin: boolean;
  adminStatus: string | null;
  userState: string | null;
  userMobileAndLeader: { mobile: string | null; leader: string | null } | null;
  sharedWithMeOwners: LeaderShareOwner[];
  savedCheckboxId: string | null;
  categories: { code: string; name: string }[];
  onEditStart: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, updates: EditUpdates) => Promise<void>;
  onDelete: (campaign: Campaign) => void;
  onToggleCheckbox: (id: string, field: 'tl_ok' | 'sr_ok', currentValue: boolean) => void;
  onRecordResults: (campaign: Campaign) => void;
}

export default function CampaignList({
  campaigns, editingId, dateFilter, isAdmin, adminStatus, userState, userMobileAndLeader,
  sharedWithMeOwners, savedCheckboxId, categories,
  onEditStart, onCancelEdit, onSaveEdit, onDelete, onToggleCheckbox, onRecordResults,
}: Props) {
  if (campaigns.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
        No campaigns found
      </div>
    );
  }

  // Group by date → state → place
  const grouped = campaigns.reduce(
    (acc, campaign) => {
      const d = campaign.date;
      const placeKey = combinePlaceAndSite(campaign.place, campaign.site);
      if (!acc[d]) acc[d] = {};
      if (!acc[d][campaign.state]) acc[d][campaign.state] = {};
      if (!acc[d][campaign.state][placeKey]) acc[d][campaign.state][placeKey] = [];
      acc[d][campaign.state][placeKey].push(campaign);
      return acc;
    },
    {} as Record<string, Record<string, Record<string, Campaign[]>>>,
  );

  const result: React.ReactElement[] = [];
  const sortedDates = Object.keys(grouped).sort();
  let lastDate = '';

  for (const date of sortedDates) {
    if (date !== lastDate) {
      result.push(
        <div
          key={`date-${date}`}
          className="bg-yellow-100 dark:bg-yellow-900/30 px-4 py-4 border-2 border-gray-800 dark:border-gray-600 border-b-2 border-yellow-300 dark:border-yellow-700"
        >
          <div className="font-bold text-xl sm:text-2xl text-yellow-900 dark:text-yellow-200 break-words">
            {new Date(date).toLocaleDateString('en-AU', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            })}
          </div>
        </div>,
      );
      lastDate = date;
    }

    for (const state of Object.keys(grouped[date]).sort()) {
      for (const place of Object.keys(grouped[date][state]).sort()) {
        for (const campaign of grouped[date][state][place]) {
          if (editingId === campaign.id) {
            result.push(
              <InlineEditForm
                key={campaign.id}
                campaign={campaign}
                isAdmin={isAdmin}
                categories={categories}
                onSave={onSaveEdit}
                onCancel={onCancelEdit}
              />,
            );
          } else {
            result.push(
              <CampaignCard
                key={campaign.id}
                campaign={campaign}
                dateFilter={dateFilter}
                isAdmin={isAdmin}
                adminStatus={adminStatus}
                userState={userState}
                userMobileAndLeader={userMobileAndLeader}
                sharedWithMeOwners={sharedWithMeOwners}
                savedCheckboxId={savedCheckboxId}
                onEdit={() => onEditStart(campaign.id)}
                onDelete={() => onDelete(campaign)}
                onToggleCheckbox={(field, val) => onToggleCheckbox(campaign.id, field, val)}
                onRecordResults={() => onRecordResults(campaign)}
              />,
            );
          }
        }
      }
    }
  }

  return <div className="divide-y divide-gray-200 dark:divide-gray-700">{result}</div>;
}
