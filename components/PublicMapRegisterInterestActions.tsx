'use client';

/**
 * The single "Contact Me about This or Other Campaigns at this Location"
 * button for a map marker on the public "Upcoming Campaigns" map
 * (app/public/upcoming-campaigns) — passed as CampaignMap's
 * `renderPlaceActions`. It registers interest in *every* campaign at the
 * place (past or future — the button applies to either), recorded as the
 * "more" interest type. The confirmation step (contact-detail fields +
 * Proceed/Cancel + submit) lives in the shared PublicRegisterInterestModal,
 * so this and the "List View" checklist on the same page present an
 * identical popup.
 */
import { useState } from 'react';
import PublicRegisterInterestModal from '@/components/PublicRegisterInterestModal';

export const CONTACT_ME_LABEL = 'Contact Me about This or Other Campaigns at this Location';

interface PublicMapRegisterInterestActionsProps {
  campaignIds: string[];
}

export default function PublicMapRegisterInterestActions({ campaignIds }: PublicMapRegisterInterestActionsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDone, setIsDone] = useState(false);

  if (isDone) {
    return (
      <p className="mt-2 text-xs font-semibold text-green-700">
        ✓ Thanks — a leader will be in touch.
      </p>
    );
  }

  return (
    <div data-ti="components/PublicMapRegisterInterestActions.tsx" className="mt-3">
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="w-full rounded-md border border-gray-800 bg-orange-500 px-2 py-2 text-sm font-bold text-white hover:bg-orange-600"
      >
        {CONTACT_ME_LABEL}
      </button>

      {isOpen && (
        <PublicRegisterInterestModal
          campaignIds={campaignIds}
          interestType="more"
          onCancel={() => setIsOpen(false)}
          onSuccess={() => setIsDone(true)}
        />
      )}
    </div>
  );
}
