'use client';

import Modal from '@/components/Modal';
import type { Campaign } from '@/lib/types';
import { formatShortDateWithOrdinal } from '@/lib/campaignDates';
import { formatCampaignTimeDisplay } from '@/lib/campaignUtils';
import { combinePlaceAndSite } from '@/lib/placeSite';

interface Props {
  campaigns: Campaign[];
  onProceed: () => void;
  onCancel: () => void;
}

/** e.g. "Frankston Wed 12th Aug 11:30am Linda" */
function formatCampaignLine(c: Campaign): string {
  const place = combinePlaceAndSite(c.place, c.site);
  const [y, m, d] = c.date.split('-').map(Number);
  const dateText = formatShortDateWithOrdinal(new Date(y, m - 1, d));
  // formatCampaignTimeDisplay gives "11:30 AM" — lowercased and de-spaced to "11:30am"
  const time = formatCampaignTimeDisplay(c.time).toLowerCase().replace(' ', '');
  return `${place} ${dateText} ${time} ${c.leader}`;
}

/**
 * Confirmation shown when "Yes I'm In" or "Tell Me More" is pressed, listing
 * the ticked campaigns and asking the leader to confirm before proceeding.
 * Proceeding is a stub for now — actually recording the interest against
 * the campaigns (using the first name / mobile number captured on the page)
 * is a follow-up piece of work.
 */
export default function InterestSummaryModal({ campaigns, onProceed, onCancel }: Props) {
  return (
    <Modal onClose={onCancel}>
      <div className="w-full max-w-sm rounded-xl border-2 border-gray-800 bg-white p-6 shadow-2xl dark:border-gray-600 dark:bg-gray-900">
        <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
          You have selected the following campaign(s)
        </p>

        <div className="mt-2 max-h-48 space-y-1 overflow-y-auto pl-4 text-sm text-gray-700 dark:text-gray-300">
          {campaigns.map(c => (
            <div key={c.id}>{formatCampaignLine(c)}</div>
          ))}
        </div>

        <p className="mt-4 text-base font-semibold text-gray-900 dark:text-gray-100">
          By selecting Proceed below you agree to being contacted by the leader(s) of the selected campaigns
        </p>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onProceed}
            className="flex-1 rounded-md bg-blue-600 px-4 py-3 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
          >
            Proceed
          </button>
          <button
            onClick={onCancel}
            className="flex-1 rounded-md bg-gray-200 px-4 py-3 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
