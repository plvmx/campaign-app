'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';

const DEVICE_ID_KEY = 'legacyReportDeviceId';
const COUNTED_KEY = 'legacyReportVisitCounted';

/** A random, anonymous id kept in this browser so repeat visits can be told from different devices. */
function getDeviceId(): string | undefined {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return undefined;
  }
}

const STEPS = [
  'Tap the green button below to open the sign-in screen, then sign in with your first name and mobile number.',
  'Find your past campaign in the list.',
  'Tap the green Record Results button on that campaign and enter your results.',
];

/**
 * Where leaders land from the old campaign results report
 * (australiaforjesus.org.au/campaignreport/). Counts the visit once per
 * browser session so an admin can see how many leaders still use the old link.
 */
export default function CampaignReportingMovedClient() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem(COUNTED_KEY)) return;
      sessionStorage.setItem(COUNTED_KEY, '1');
    } catch {
      // Storage blocked: still count this load.
    }
    fetch('/api/public/legacy-report-visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId() }),
    }).catch(() => {
      // Counting is best-effort and must never get in the leader's way.
    });
  }, []);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 dark:bg-gray-900">
      <div className="mx-auto max-w-xl rounded-lg border-2 border-gray-800 bg-white p-6 shadow-sm dark:border-gray-600 dark:bg-gray-800">
        <div className="mb-6 flex justify-center">
          <Image src="/twol_banner.png" alt="The Way of Life" width={280} height={121} className="h-auto w-auto max-w-full" priority />
        </div>

        <h1 className="text-center text-2xl font-bold text-gray-900 dark:text-gray-100">
          Campaign reporting has moved
        </h1>

        <p className="mt-4 text-base text-gray-800 dark:text-gray-200">
          The old campaign results report is no longer used.{' '}
          <strong>All campaign reporting must now be done in the TWOL CAS App.</strong>
        </p>

        <h2 className="mt-6 text-lg font-bold text-gray-900 dark:text-gray-100">How to record your results</h2>
        <ol className="mt-2 list-decimal space-y-3 pl-6 text-base text-gray-800 dark:text-gray-200">
          {STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>

        <Link
          href="/login"
          className="mt-8 block w-full rounded-md border-2 border-gray-800 bg-green-600 px-4 py-3 text-center text-lg font-bold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:border-gray-600"
        >
          Go to the app sign-in
        </Link>
      </div>
    </main>
  );
}
