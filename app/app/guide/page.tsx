'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PdfGuideViewer from '@/components/PdfGuideViewer';
import { useUser } from '@/contexts/UserContext';
import { getErrorMessage } from '@/lib/errorUtils';
import { fetchUserGuide } from '@/lib/services/userGuideClient';
import type { UserGuideView } from '@/lib/services/userGuideService';

/**
 * "OPEN GUIDE" — shows the current CAS User Guide PDF (uploaded by an admin on
 * /admin; see lib/services/userGuideService.ts) straight away, full screen,
 * with a Close button that returns to wherever the leader came from. The PDF
 * is drawn inside the app (components/PdfGuideViewer.tsx) because the
 * browser's own PDF viewer has no way back into the app; if that fails (e.g.
 * a very old phone) the leader is offered the plain link instead.
 */
export default function GuidePage() {
  const router = useRouter();
  const { user, isLoading: isUserLoading } = useUser();
  // undefined = still loading; null = no guide uploaded yet
  const [guide, setGuide] = useState<UserGuideView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [viewerFailed, setViewerFailed] = useState(false);

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

  const handleClose = () => {
    // Back to the screen the leader tapped OPEN GUIDE on; home if the guide
    // was opened directly (e.g. a bookmarked or reloaded page).
    if (window.history.length > 1) router.back();
    else router.push('/app');
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-200 dark:bg-gray-900">
      <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-3 border-b-2 border-gray-800 bg-white px-4 dark:border-gray-600 dark:bg-gray-950">
        <h1 className="truncate text-xl font-bold text-gray-900 dark:text-gray-100">CAS User Guide</h1>
        <button
          onClick={handleClose}
          className="whitespace-nowrap rounded-md border-2 border-gray-800 bg-blue-600 px-5 py-2 text-xl font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-600"
        >
          ✕ Close
        </button>
      </header>

      <main className="flex-1 px-2 py-3">
        {error ? (
          <p className="mx-auto max-w-xl p-6 text-center text-xl text-red-700 dark:text-red-300">{error}</p>
        ) : guide === null ? (
          <p className="mx-auto max-w-xl p-6 text-center text-xl text-gray-700 dark:text-gray-300">
            The guide isn&apos;t available yet. Please check back soon.
          </p>
        ) : guide === undefined ? (
          <p className="p-8 text-center text-xl text-gray-700 dark:text-gray-300">Opening the guide…</p>
        ) : viewerFailed ? (
          <div className="mx-auto max-w-xl p-6 text-center">
            <p className="text-xl text-gray-700 dark:text-gray-300">The guide couldn&apos;t be shown here.</p>
            <a
              href={guide.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 block w-full rounded-md border-2 border-gray-800 bg-blue-600 px-4 py-4 text-xl font-bold text-white hover:bg-blue-700 dark:border-gray-600"
            >
              Open the guide in a new page
            </a>
          </div>
        ) : (
          <PdfGuideViewer
            url={guide.url}
            onError={(err) => {
              console.error('[guide] in-app viewer failed:', err);
              setViewerFailed(true);
            }}
          />
        )}
      </main>
    </div>
  );
}
