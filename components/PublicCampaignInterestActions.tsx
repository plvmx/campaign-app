'use client';

/**
 * Real "Yes I'm In" / "Tell Me More" actions for the public "Campaigns Near
 * Me" screen (app/public/campaigns-near-me) — the registrant-facing
 * counterpart to components/MapPopupActions.tsx's admin stub. Submits
 * straight to /api/public/campaigns-near-me's POST handler with only the
 * registrant id it already has (from the page's own `?r=` param) — no
 * name/mobile/email re-entry, since the server looks those up from
 * registry.registrants itself.
 *
 * Same consent-confirmation step as the general public Register Interest
 * flow (components/registerInterest/InterestSummaryModal.tsx) before
 * either button actually submits — reusing the shared Modal component
 * that flow already established (its z-index is deliberately high enough
 * to sit above this screen's Leaflet map, see components/Modal.tsx).
 */
import { useState } from 'react';
import Modal from '@/components/Modal';

type Status = 'idle' | 'submitting' | 'done' | 'error';
type InterestType = 'in' | 'more';

interface PublicCampaignInterestActionsProps {
  registrantId: string;
  campaignId: string;
}

export default function PublicCampaignInterestActions({ registrantId, campaignId }: PublicCampaignInterestActionsProps) {
  const [pendingType, setPendingType] = useState<InterestType | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [doneType, setDoneType] = useState<InterestType | null>(null);
  const [error, setError] = useState<string | null>(null);

  function requestConfirmation(interestType: InterestType) {
    setError(null);
    setPendingType(interestType);
  }

  async function confirm() {
    if (!pendingType) return;
    setStatus('submitting');
    setError(null);
    try {
      const res = await fetch('/api/public/campaigns-near-me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrantId, campaignId, interestType: pendingType }),
      });
      const json = await res.json();
      if (!res.ok) {
        setStatus('error');
        setError(json.error ?? 'Something went wrong — please try again.');
        return;
      }
      setDoneType(pendingType);
      setStatus('done');
      setPendingType(null);
    } catch (err) {
      console.error('[PublicCampaignInterestActions] submit failed:', err);
      setStatus('error');
      setError('Something went wrong — please try again.');
    }
  }

  function cancel() {
    if (status === 'submitting') return;
    setPendingType(null);
    setStatus('idle');
    setError(null);
  }

  if (status === 'done') {
    return (
      <p className="mt-2 text-xs font-semibold text-green-700">
        {doneType === 'in' ? "✓ Thanks — you're registered! A leader will be in touch." : '✓ Thanks — someone will reach out with more details.'}
      </p>
    );
  }

  return (
    <div className="mt-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => requestConfirmation('in')}
          className="rounded-md border border-gray-800 bg-green-600 px-2 py-1 text-xs font-bold text-white hover:bg-green-700"
        >
          Yes I&apos;m In
        </button>
        <button
          type="button"
          onClick={() => requestConfirmation('more')}
          className="rounded-md border border-gray-800 bg-orange-500 px-2 py-1 text-xs font-bold text-white hover:bg-orange-600"
        >
          Tell Me More
        </button>
      </div>

      {pendingType && (
        <Modal onClose={status === 'submitting' ? undefined : cancel}>
          <div className="w-full max-w-sm rounded-xl border-2 border-gray-800 bg-white p-6 text-left shadow-2xl dark:border-gray-600 dark:bg-gray-900">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              By proceeding you agree that your details will be made available to the team leader of this campaign, and you give your
              permission for them to contact you regarding their campaign.
            </p>

            {error && (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
                {error}
              </p>
            )}

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={confirm}
                disabled={status === 'submitting'}
                className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 border-2 border-gray-800 dark:border-gray-600"
              >
                {status === 'submitting' ? 'Submitting…' : 'Proceed'}
              </button>
              <button
                type="button"
                onClick={cancel}
                disabled={status === 'submitting'}
                className="flex-1 rounded-md bg-gray-200 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
