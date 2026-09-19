'use client';

/**
 * "Yes I'm In" / "Tell Me More" actions for the public "Upcoming Campaigns"
 * map (app/public/upcoming-campaigns) — passed as CampaignMap's
 * `renderActions`. Unlike PublicCampaignInterestActions.tsx (the
 * campaigns-near-me equivalent), this visitor has no known identity — no
 * registrant id to look name/mobile/email up from — so the confirmation
 * step also captures those, same fields and validation as the general
 * public Register Interest form (components/registerInterest/), then
 * submits straight to POST /api/public/register-interest with a single
 * campaign id.
 */
import { useState } from 'react';
import Modal from '@/components/Modal';
import { isValidMobile, isValidEmail } from '@/lib/validation';

type Status = 'idle' | 'submitting' | 'done' | 'error';
type InterestType = 'in' | 'more';

interface PublicMapRegisterInterestActionsProps {
  campaignId: string;
}

export default function PublicMapRegisterInterestActions({ campaignId }: PublicMapRegisterInterestActionsProps) {
  const [pendingType, setPendingType] = useState<InterestType | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [doneType, setDoneType] = useState<InterestType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');

  function requestConfirmation(interestType: InterestType) {
    setError(null);
    setPendingType(interestType);
  }

  async function confirm() {
    if (!pendingType) return;

    if (!firstName.trim()) {
      setError('Please enter your first name');
      return;
    }
    if (!isValidMobile(mobile) && !isValidEmail(email)) {
      setError('Please enter a valid mobile number or email address');
      return;
    }

    setStatus('submitting');
    setError(null);
    try {
      const res = await fetch('/api/public/register-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          mobile: mobile.trim(),
          email: email.trim(),
          interestType: pendingType,
          campaignIds: [campaignId],
        }),
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
      console.error('[PublicMapRegisterInterestActions] submit failed:', err);
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
              Enter your details below. By proceeding you agree that they will be made available to the team leader of this
              campaign, and you give your permission for them to contact you regarding their campaign.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">First name</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Mobile number</label>
                <input
                  type="tel"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="04XX XXX XXX"
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Email (optional if mobile provided)</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
            </div>

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
