'use client';

import { useEffect, useState } from 'react';
import OpenGuideLabel from '@/components/OpenGuideLabel';
import PdfGuideViewer from '@/components/PdfGuideViewer';
import { getErrorMessage } from '@/lib/errorUtils';
import { fetchUserGuide } from '@/lib/services/userGuideClient';
import type { UserGuideView } from '@/lib/services/userGuideService';

/**
 * The CAS User Guide, full screen, with a Close button — what every OPEN
 * GUIDE button shows (uploaded by an admin on /admin; see
 * lib/services/userGuideService.ts). No sign-in needed. The PDF is drawn
 * inside the app (PdfGuideViewer) because the browser's own PDF viewer has
 * no way back into the app; if that fails (e.g. a very old phone) the plain
 * link is offered instead.
 *
 * Used as the /app/guide page (bottom-bar button) and shown in place on the
 * sign-in and "What do you want to do today?" screens, so closing it there
 * returns to exactly where the leader was.
 */
export default function GuideScreen({ onClose }: { onClose: () => void }) {
  // undefined = still loading; null = no guide uploaded yet
  const [guide, setGuide] = useState<UserGuideView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [viewerFailed, setViewerFailed] = useState(false);

  useEffect(() => {
    // Opened in place from a scrolled-down screen (e.g. the sign-in form):
    // start at the top of the guide, not part-way down.
    window.scrollTo(0, 0);
    let cancelled = false;
    fetchUserGuide()
      .then((result) => { if (!cancelled) setGuide(result); })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'The guide could not be loaded'));
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div data-ti="components/GuideScreen.tsx" className="flex min-h-screen flex-col bg-gray-200 dark:bg-gray-900">
      <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-3 border-b-2 border-gray-800 bg-white px-4 dark:border-gray-600 dark:bg-gray-950">
        <h1 className="truncate text-xl font-bold text-gray-900 dark:text-gray-100">CAS User Guide</h1>
        <button
          onClick={onClose}
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

/**
 * The OPEN GUIDE button for the sign-in and "What do you want to do today?"
 * screens — deliberately low-key, styled exactly like the bottom-bar button
 * (Peter, 2026-10-15): just the gold stacked label, no box.
 */
export function OpenGuideButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex justify-center">
      <button
        type="button"
        onClick={onClick}
        aria-label="OPEN GUIDE"
        className="rounded-md px-4 py-2 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:hover:bg-gray-800"
      >
        <OpenGuideLabel />
      </button>
    </div>
  );
}
