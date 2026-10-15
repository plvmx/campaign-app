'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { getErrorMessage } from '@/lib/errorUtils';
import { fetchUserGuide } from '@/lib/services/userGuideClient';
import { formatGuideDate, type UserGuideView } from '@/lib/services/userGuideService';

/**
 * "OPEN GUIDE" — opens the current CAS User Guide PDF (uploaded by an admin on
 * /admin; see lib/services/userGuideService.ts). The PDF opens in the
 * phone's own PDF viewer rather than inside the app, since an embedded PDF
 * on a phone often shows only the first page.
 */
export default function GuidePage() {
  const router = useRouter();
  const { user, isLoading: isUserLoading } = useUser();
  // undefined = still loading; null = no guide uploaded yet
  const [guide, setGuide] = useState<UserGuideView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    let cancelled = false;
    fetchUserGuide()
      .then((result) => { if (!cancelled) setGuide(result); })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'The guide could not be loaded'));
      });
    return () => { cancelled = true; };
  }, [isUserLoading, user, router]);

  if (isUserLoading || (guide === undefined && !error)) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center"><LoadingSpinner /></div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="mx-auto max-w-xl p-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">CAS User Guide</h1>

        {error ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-base text-red-700 dark:text-red-300">{error}</p>
          </div>
        ) : guide ? (
          <>
            <p className="mt-2 text-base text-gray-700 dark:text-gray-300">
              Step-by-step instructions, with pictures, for using the Campaign Activity System app.
            </p>
            <a
              href={guide.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 block w-full rounded-md bg-blue-600 px-4 py-4 text-center text-xl font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Open the Guide
            </a>
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
              The guide opens in a new page. When you are finished, close it or go back to return to the app.
            </p>
            <p className="mt-6 text-sm text-gray-500 dark:text-gray-400">
              Last updated {formatGuideDate(guide.uploadedAt)}
            </p>
          </>
        ) : (
          <p className="mt-4 text-base text-gray-700 dark:text-gray-300">
            The guide isn&apos;t available yet. Please check back soon.
          </p>
        )}
      </div>
    </MobileLayout>
  );
}
