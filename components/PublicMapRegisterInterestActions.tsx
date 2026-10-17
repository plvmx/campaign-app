'use client';

/**
 * "Yes I'm In" / "Tell Me More" trigger buttons for a single map-marker
 * campaign on the public "Upcoming Campaigns" map (app/public/upcoming-campaigns)
 * — passed as CampaignMap's `renderActions`. The actual confirmation step
 * (contact-detail fields + Proceed/Cancel + submit) lives in the shared
 * PublicRegisterInterestModal, so this and the "List View" checklist on
 * the same page present an identical popup.
 */
import { useState } from 'react';
import PublicRegisterInterestModal, { type PublicInterestType } from '@/components/PublicRegisterInterestModal';

interface PublicMapRegisterInterestActionsProps {
  campaignId: string;
  /** The campaign has already happened — interest can't be registered. */
  isPast?: boolean;
}

export default function PublicMapRegisterInterestActions({ campaignId, isPast = false }: PublicMapRegisterInterestActionsProps) {
  const [pendingType, setPendingType] = useState<PublicInterestType | null>(null);
  const [doneType, setDoneType] = useState<PublicInterestType | null>(null);

  if (isPast) {
    return (
      <p className="mt-2 text-xs font-semibold text-gray-600" data-testid="campaign-past-note">
        This campaign has already taken place.
      </p>
    );
  }

  if (doneType) {
    return (
      <p className="mt-2 text-xs font-semibold text-green-700">
        {doneType === 'in' ? "✓ Thanks — you're registered! A leader will be in touch." : '✓ Thanks — someone will reach out with more details.'}
      </p>
    );
  }

  return (
    <div data-ti="components/PublicMapRegisterInterestActions.tsx" className="mt-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setPendingType('in')}
          className="rounded-md border border-gray-800 bg-green-600 px-2 py-1 text-xs font-bold text-white hover:bg-green-700"
        >
          Yes I&apos;m In
        </button>
        <button
          type="button"
          onClick={() => setPendingType('more')}
          className="rounded-md border border-gray-800 bg-orange-500 px-2 py-1 text-xs font-bold text-white hover:bg-orange-600"
        >
          Tell Me More
        </button>
      </div>
      <p className="mt-1 text-xs text-gray-600">
        <strong>Yes I&apos;m In</strong> — a leader will contact you. <strong>Tell Me More</strong> — we&apos;ll send you details.
      </p>

      {pendingType && (
        <PublicRegisterInterestModal
          campaignIds={[campaignId]}
          interestType={pendingType}
          onCancel={() => setPendingType(null)}
          onSuccess={() => setDoneType(pendingType)}
        />
      )}
    </div>
  );
}
