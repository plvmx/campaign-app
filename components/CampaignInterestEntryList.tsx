'use client';

import type { CampaignInterestWithCampaign } from '@/lib/services/campaignInterestService';
import { getSlideStateColor } from '@/lib/slideLayout';
import { formatCampaignTimeDisplay } from '@/lib/campaignUtils';
import { combinePlaceAndSite } from '@/lib/placeSite';

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString('en-AU', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

interface Props {
  entries: CampaignInterestWithCampaign[];
  updatingIds: Set<string>;
  onToggleContacted: (id: string, contacted: boolean) => void;
}

/**
 * Row rendering shared by /admin/registered-interest (every registration,
 * admin-only) and /campaign-interest (a leader's own campaigns only) — same
 * data shape, same Contacted-checkbox interaction, differing only in which
 * rows the caller fetched. Renders just the row list (not the surrounding
 * card/header), so callers control the "Registrations (N)" title and empty
 * vs loaded framing around it.
 */
export default function CampaignInterestEntryList({ entries, updatingIds, onToggleContacted }: Props) {
  if (entries.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
        No one has registered interest yet.
      </div>
    );
  }

  return (
    <>
      {entries.map((entry) => {
        const campaign = entry.campaign;
        const isUpdating = updatingIds.has(entry.id);
        return (
          <div key={entry.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {campaign ? (
                  <div className="font-bold" style={{ color: getSlideStateColor(campaign.state) }}>
                    {combinePlaceAndSite(campaign.place, campaign.site)} — {campaign.state}
                  </div>
                ) : (
                  <div className="font-bold text-gray-400 italic">Campaign no longer exists</div>
                )}
                {campaign && (
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {new Date(campaign.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                    {' at '}{formatCampaignTimeDisplay(campaign.time)} — Leader: {campaign.leader}
                  </div>
                )}
                <div className="mt-2 text-base text-gray-900 dark:text-gray-100">
                  {entry.first_name} — {entry.mobile}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`rounded-md px-2 py-0.5 font-bold text-white ${
                      entry.interest_type === 'in' ? 'bg-green-600' : 'bg-orange-500'
                    }`}
                  >
                    {entry.interest_type === 'in' ? "Yes I'm In" : 'Tell Me More'}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400">
                    Registered {formatDateTime(entry.created_at)}
                  </span>
                </div>
              </div>

              <div className="shrink-0 text-right">
                <label className="flex items-center justify-end gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  <span>Contacted</span>
                  <input
                    type="checkbox"
                    checked={entry.contacted}
                    disabled={isUpdating}
                    onChange={(e) => onToggleContacted(entry.id, e.target.checked)}
                    className="h-5 w-5 accent-blue-600 disabled:opacity-50"
                  />
                </label>
                {entry.contacted && entry.contacted_at && (
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {formatDateTime(entry.contacted_at)}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
