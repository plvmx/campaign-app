'use client';

/**
 * /public/donate — the simplified Phase 0 donations flow: one page with two
 * paths, replacing the old www.australiaforjesus.org.au -> /mobilise ->
 * /donate-options -> Donorbox chain (see CLAUDE.md's Phase 0 donations
 * note). Card donations link straight through to Donorbox, which captures
 * its own donor details — there's no pre-form here. Bank-transfer donors
 * see the account details plus an optional "let us know you're
 * transferring" notice, since Donorbox never sees that payment.
 *
 * Deliberately does NOT use MobileLayout — this is a no-login public page,
 * same reasoning as RegisterInterestClient.
 */
import { useState } from 'react';
import { getErrorMessage } from '@/lib/errorUtils';
import {
  DONOR_NAME_MAX_LENGTH,
  sanitizeDonorNameInput,
  sanitizeDonationAmountInput,
  validateDonationNoticeForm,
  hasDonationNoticeFormErrors,
  type DonationNoticeFormErrors,
} from '@/lib/donationNotice';
import {
  DONORBOX_URL,
  BANK_ACCOUNT_NAME,
  BANK_BSB,
  BANK_ACCOUNT_NUMBER,
  BANK_REFERENCE_HINT,
} from '@/lib/donationBankDetails';

const inputClass = (hasError: boolean) =>
  `mt-1 block w-full rounded-md border-2 bg-white px-3 py-2 text-base text-gray-900 dark:bg-gray-700 dark:text-gray-100 ${
    hasError ? 'border-red-600 dark:border-red-500' : 'border-gray-800 dark:border-gray-600'
  }`;

export default function DonateClient() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState<DonationNoticeFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const edit = (apply: () => void) => {
    apply();
    setSubmitError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateDonationNoticeForm({ name, email, amount });
    setErrors(found);
    if (hasDonationNoticeFormErrors(found)) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/public/donate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), amount: amount.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'Could not send your note');
      setSent(true);
    } catch (err) {
      setSubmitError(getErrorMessage(err, 'Could not send your note'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main data-ti="components/donate/DonateClient.tsx" className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Donate</h1>
      <p className="mt-2 text-base text-gray-700 dark:text-gray-300">
        Thank you for supporting Australia For Jesus. Choose whichever way works for you below.
      </p>

      <section className="mt-8 rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-5 shadow-sm dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Donate by card</h2>
        <p className="mt-2 text-base text-gray-700 dark:text-gray-300">
          Make a one-time or monthly donation securely by card. You&apos;ll enter your own details on the next page.
        </p>
        <a
          href={DONORBOX_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block rounded-md bg-blue-600 px-6 py-3 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
        >
          Donate Now by Card
        </a>
      </section>

      <section className="mt-6 rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-5 shadow-sm dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Donate by direct bank transfer</h2>
        <p className="mt-2 text-base text-gray-700 dark:text-gray-300">Prefer to transfer directly? Use these details:</p>
        <dl className="mt-3 space-y-1 text-base text-gray-900 dark:text-gray-100">
          <div className="flex justify-between gap-4"><dt className="font-semibold">Account Name</dt><dd>{BANK_ACCOUNT_NAME}</dd></div>
          <div className="flex justify-between gap-4"><dt className="font-semibold">BSB</dt><dd>{BANK_BSB}</dd></div>
          <div className="flex justify-between gap-4"><dt className="font-semibold">Account Number</dt><dd>{BANK_ACCOUNT_NUMBER}</dd></div>
        </dl>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{BANK_REFERENCE_HINT}</p>

        {sent ? (
          <p className="mt-5 text-base font-semibold text-green-700 dark:text-green-300">
            Thanks, {name.trim()} — we&apos;ve been notified. You&apos;re all set to make your transfer.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 border-t border-gray-300 dark:border-gray-600 pt-5" noValidate>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              Optional: let us know you&apos;re transferring, so we can look out for it.
            </p>

            <div className="mt-3">
              <label htmlFor="donor-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Your name</label>
              <input
                id="donor-name"
                type="text"
                maxLength={DONOR_NAME_MAX_LENGTH}
                autoComplete="name"
                disabled={submitting}
                value={name}
                onChange={(e) => edit(() => setName(sanitizeDonorNameInput(e.target.value)))}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? 'donor-name-error' : undefined}
                className={inputClass(!!errors.name)}
              />
              {errors.name && <p id="donor-name-error" role="alert" className="mt-1 text-sm font-semibold text-red-700 dark:text-red-400">{errors.name}</p>}
            </div>

            <div className="mt-3">
              <label htmlFor="donor-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Email (optional)</label>
              <input
                id="donor-email"
                type="text"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={200}
                disabled={submitting}
                value={email}
                onChange={(e) => edit(() => setEmail(e.target.value))}
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'donor-email-error' : undefined}
                className={inputClass(!!errors.email)}
              />
              {errors.email && <p id="donor-email-error" role="alert" className="mt-1 text-sm font-semibold text-red-700 dark:text-red-400">{errors.email}</p>}
            </div>

            <div className="mt-3">
              <label htmlFor="donor-amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Amount (optional)</label>
              <input
                id="donor-amount"
                type="text"
                inputMode="decimal"
                disabled={submitting}
                value={amount}
                onChange={(e) => edit(() => setAmount(sanitizeDonationAmountInput(e.target.value)))}
                aria-invalid={!!errors.amount}
                aria-describedby={errors.amount ? 'donor-amount-error' : undefined}
                className={inputClass(!!errors.amount)}
              />
              {errors.amount && <p id="donor-amount-error" role="alert" className="mt-1 text-sm font-semibold text-red-700 dark:text-red-400">{errors.amount}</p>}
            </div>

            {submitError && <p role="alert" className="mt-3 text-sm font-semibold text-red-700 dark:text-red-400">{submitError}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="mt-4 rounded-md bg-blue-600 px-5 py-2.5 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 border-2 border-gray-800 dark:border-gray-600"
            >
              {submitting ? 'Sending…' : "Let us know I'm transferring"}
            </button>
          </form>
        )}
      </section>

      <p className="mt-8 text-center text-base text-gray-700 dark:text-gray-300">Thank you for your generosity.</p>
    </main>
  );
}
