'use client';

/**
 * Public, unauthenticated training-interest page — shows one training
 * session's details (a campaign with category BOTJ or TLT) and lets a
 * visitor register interest with their name + a mobile number or email.
 * Not listed in middleware's PROTECTED_PREFIXES, so it's open by default
 * (see middleware.ts). Data comes from GET
 * /api/public/training-interest/[campaignId]; submission goes through POST
 * on the same route (service role — see that route for why training_interest
 * can't be written via the browser client here).
 *
 * Deliberately does NOT use MobileLayout — that component resolves the
 * signed-in user's admin status and assumes a logged-in session.
 *
 * Split out of page.tsx (a Server Component, for its `metadata` export — a
 * 'use client' page can't export metadata) — see page.tsx.
 */
import { useEffect, useState } from 'react';
import LoadingSpinner from '@/components/LoadingSpinner';
import { formatCampaignTimeDisplay } from '@/lib/campaignUtils';
import { combinePlaceAndSite } from '@/lib/placeSite';
import { getErrorMessage } from '@/lib/errorUtils';
import type { TrainingInterestGetResponse } from '@/app/api/public/training-interest/[campaignId]/route';

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

export default function TrainingInterestClient({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<TrainingInterestGetResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/public/training-interest/${campaignId}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || 'Failed to load training session details');
        if (cancelled) return;
        setData(json as TrainingInterestGetResponse);
      } catch (err) {
        if (!cancelled) setLoadError(getErrorMessage(err, 'Failed to load training session details'));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [campaignId]);

  const handleSubmit = async () => {
    setValidationError(null);
    if (!name.trim()) {
      setValidationError('Please enter your name.');
      return;
    }
    if (!mobile.trim() && !email.trim()) {
      setValidationError('Please enter a mobile number or email address.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/public/training-interest/${campaignId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), mobile: mobile.trim(), email: email.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to register your interest');
      setSubmitted(true);
    } catch (err: unknown) {
      setSubmitError(getErrorMessage(err, 'Failed to register your interest'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <LoadingSpinner text="Loading training session…" />
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
          {loadError || 'This training session could not be found.'}
        </div>
      </div>
    );
  }

  const { campaign, categoryName } = data;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col p-4">
      <div className="mb-4">
        <span className="inline-block rounded-md bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">
          {categoryName}
        </span>
        <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
          {combinePlaceAndSite(campaign.place, campaign.site)}, {campaign.state}
        </h1>
        <p className="mt-1 text-base text-gray-700 dark:text-gray-300">
          {formatDate(campaign.date)} at {formatCampaignTimeDisplay(campaign.time)}
        </p>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Led by <span className="font-semibold">{campaign.leader}</span>
        </p>
      </div>

      {submitted ? (
        <div className="rounded-lg border-2 border-green-600 bg-green-50 p-4 text-center dark:border-green-500 dark:bg-green-900/20">
          <p className="text-lg font-bold text-green-800 dark:text-green-200">Thanks — you&apos;re registered!</p>
          <p className="mt-1 text-sm text-green-700 dark:text-green-300">
            {campaign.leader} will be in touch about this training session.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border-2 border-gray-800 p-4 dark:border-gray-600">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">I&apos;m Interested</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Enter your details below and click the button to let {campaign.leader} know you&apos;d like to join.
          </p>

          <div className="mt-3 flex flex-col gap-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Name</span>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name"
                className="w-full rounded-md border-2 border-gray-800 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Mobile number</span>
              <input
                type="tel"
                value={mobile}
                onChange={e => setMobile(e.target.value)}
                placeholder="Mobile number"
                className="w-full rounded-md border-2 border-gray-800 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Email address</span>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Email address"
                className="w-full rounded-md border-2 border-gray-800 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
              />
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">Please provide at least a mobile number or an email address.</p>
          </div>

          {validationError && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
              {validationError}
            </div>
          )}
          {submitError && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
              {submitError}
            </div>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="mt-4 w-full rounded-md bg-green-600 px-4 py-3 text-base font-bold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 border-2 border-gray-800 dark:border-gray-600"
          >
            {isSubmitting ? 'Submitting…' : "I'm Interested"}
          </button>
        </div>
      )}
    </div>
  );
}
