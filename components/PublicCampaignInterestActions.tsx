'use client';

/**
 * Real "Yes I'm In" / "Tell Me More" actions for the public "Campaigns Near
 * Me" screen (app/public/campaigns-near-me) — the registrant-facing
 * counterpart to components/MapPopupActions.tsx's admin stub. Submits
 * straight to /api/public/campaigns-near-me's POST handler with only the
 * registrant id it already has (from the page's own `?r=` param) — no
 * name/mobile/email re-entry, since the server looks those up from
 * registry.registrants itself.
 */
import { useState } from 'react';

type Status = 'idle' | 'submitting' | 'done' | 'error';

interface PublicCampaignInterestActionsProps {
  registrantId: string;
  campaignId: string;
}

export default function PublicCampaignInterestActions({ registrantId, campaignId }: PublicCampaignInterestActionsProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [doneType, setDoneType] = useState<'in' | 'more' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(interestType: 'in' | 'more') {
    setStatus('submitting');
    setError(null);
    try {
      const res = await fetch('/api/public/campaigns-near-me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrantId, campaignId, interestType }),
      });
      const json = await res.json();
      if (!res.ok) {
        setStatus('error');
        setError(json.error ?? 'Something went wrong — please try again.');
        return;
      }
      setDoneType(interestType);
      setStatus('done');
    } catch (err) {
      console.error('[PublicCampaignInterestActions] submit failed:', err);
      setStatus('error');
      setError('Something went wrong — please try again.');
    }
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
          onClick={() => submit('in')}
          disabled={status === 'submitting'}
          className="rounded-md border border-gray-800 bg-green-600 px-2 py-1 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50"
        >
          Yes I&apos;m In
        </button>
        <button
          type="button"
          onClick={() => submit('more')}
          disabled={status === 'submitting'}
          className="rounded-md border border-gray-800 bg-orange-500 px-2 py-1 text-xs font-bold text-white hover:bg-orange-600 disabled:opacity-50"
        >
          Tell Me More
        </button>
      </div>
      {status === 'submitting' && <p className="mt-1 text-xs text-gray-500">Submitting…</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
