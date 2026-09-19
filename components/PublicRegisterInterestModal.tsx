'use client';

/**
 * Confirmation modal for a general public visitor registering interest —
 * no known identity to look name/mobile/email up from (unlike
 * PublicCampaignInterestActions.tsx's registrant-specific flow), so this
 * collects them inline before submitting to POST
 * /api/public/register-interest. Shared by PublicMapRegisterInterestActions.tsx
 * (a single map-marker campaign) and the "List View" checklist on
 * /public/upcoming-campaigns (one or more ticked campaigns), so both
 * screens present an identical confirmation step with the same Proceed/
 * Cancel buttons and contact fields.
 */
import { useState } from 'react';
import Modal from '@/components/Modal';
import { isValidMobile, isValidEmail } from '@/lib/validation';

export type PublicInterestType = 'in' | 'more';

interface PublicRegisterInterestModalProps {
  campaignIds: string[];
  interestType: PublicInterestType;
  onCancel: () => void;
  onSuccess: () => void;
}

export default function PublicRegisterInterestModal({ campaignIds, interestType, onCancel, onSuccess }: PublicRegisterInterestModalProps) {
  const [firstName, setFirstName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!firstName.trim()) {
      setError('Please enter your first name');
      return;
    }
    if (!isValidMobile(mobile) && !isValidEmail(email)) {
      setError('Please enter a valid mobile number or email address');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/public/register-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          mobile: mobile.trim(),
          email: email.trim(),
          interestType,
          campaignIds,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong — please try again.');
        setIsSubmitting(false);
        return;
      }
      onSuccess();
    } catch (err) {
      console.error('[PublicRegisterInterestModal] submit failed:', err);
      setError('Something went wrong — please try again.');
      setIsSubmitting(false);
    }
  }

  return (
    <Modal onClose={isSubmitting ? undefined : onCancel}>
      <div className="w-full max-w-sm rounded-xl border-2 border-gray-800 bg-white p-6 text-left shadow-2xl dark:border-gray-600 dark:bg-gray-900">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Enter your details below. By proceeding you agree that they will be made available to the team leader(s) of the
          selected campaign(s), and you give your permission for them to contact you regarding their campaign.
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
            disabled={isSubmitting}
            className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 border-2 border-gray-800 dark:border-gray-600"
          >
            {isSubmitting ? 'Submitting…' : 'Proceed'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="flex-1 rounded-md bg-gray-200 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
