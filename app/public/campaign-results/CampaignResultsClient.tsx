'use client';

/**
 * Public, unauthenticated "Campaign Results" list — mirrors the "All States"
 * output of the Admin Quick Actions "Campaign Results" download, but reachable
 * via a static link with no login. Not listed in middleware's PROTECTED_PREFIXES,
 * so it's open by default (see middleware.ts).
 *
 * Unlike /public/week1-campaigns (always exactly one image), a results report
 * can span multiple JPEG pages — so each page gets its own "Download JPEG for
 * Page N" button followed by its image, matching the ZIP's page boundaries
 * (lib/reportGenerator.ts's chunkReportRows). Clicking an image opens it full
 * screen in landscape (components/FullscreenImageViewer.tsx).
 *
 * Deliberately does NOT use MobileLayout — that component resolves the
 * signed-in user's admin status and assumes a logged-in session.
 */
import { useEffect, useRef, useState } from 'react';
import LoadingSpinner from '@/components/LoadingSpinner';
import FullscreenImageViewer from '@/components/FullscreenImageViewer';
import SaveImageButton from '@/components/SaveImageButton';
import { getErrorMessage } from '@/lib/errorUtils';
import { formatDownloadDate } from '@/lib/slideLayout';
import { formatLongDateWithOrdinal, getCampaignResultsNoticeDate } from '@/lib/campaignDates';
import { drawReportPage, canvasToJpegBlob } from '@/lib/reportCanvas';
import { chunkReportRows } from '@/lib/reportGenerator';
import type { CampaignResultsResponse } from '@/app/api/public/campaign-results/route';

interface ResultPage {
  imgUrl: string;
  filename: string;
  blob: Blob;
}

/**
 * `onClose` switches to the in-app version (the Extras box on /app): shown as
 * a full-screen overlay with a return link, and with no "Save to Photos"
 * buttons — just "Download a Copy of Page N".
 */
export default function CampaignResultsClient({ onClose }: { onClose?: () => void } = {}) {
  const inApp = onClose !== undefined;
  const [progress, setProgress] = useState('Loading campaign results…');
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<ResultPage[] | null>(null);
  // The notice's date follows from which week the server chose to show, so
  // it's only known once the results have loaded.
  const [noticeDateLabel, setNoticeDateLabel] = useState<string | null>(null);
  const [fullscreenPage, setFullscreenPage] = useState<number | null>(null);
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    // Captured once so the cleanup below revokes exactly the URLs this run
    // created, regardless of what objectUrlsRef.current points to later.
    const objectUrls = objectUrlsRef.current;

    (async () => {
      try {
        const res = await fetch('/api/public/campaign-results');
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || 'Failed to load campaign results');
        if (cancelled) return;

        const { rows, weekStart } = json as CampaignResultsResponse;
        const [y, m, d] = weekStart.split('-').map(Number);
        setNoticeDateLabel(formatLongDateWithOrdinal(getCampaignResultsNoticeDate(new Date(y, m - 1, d))));
        if (rows.length === 0) {
          setPages([]);
          return;
        }

        const rowPages = chunkReportRows(rows);
        const datePrefix = formatDownloadDate(new Date());
        const built: ResultPage[] = [];

        for (let i = 0; i < rowPages.length; i++) {
          setProgress(`Rendering page ${i + 1} of ${rowPages.length}…`);
          const canvas = drawReportPage(rowPages[i]);
          const blob = await canvasToJpegBlob(canvas);
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          objectUrls.push(url);
          const suffix = rowPages.length > 1 ? `_part${i + 1}` : '';
          built.push({ imgUrl: url, filename: `${datePrefix}_Campaign_Results${suffix}.jpeg`, blob });
        }

        if (cancelled) return;
        setPages(built);
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err, 'Failed to load Campaign Results'));
      }
    })();

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  return (
    <div
      data-ti="app/public/campaign-results/CampaignResultsClient.tsx"
      className={`bg-gray-100 p-4 dark:bg-gray-950 ${inApp ? 'fixed inset-0 z-50 overflow-y-auto' : 'min-h-screen'}`}
    >
      <div className="mx-auto max-w-4xl">
        {onClose && <ReturnLink onClose={onClose} />}
        <div
          role="note"
          className="mb-4 rounded-lg border-2 border-red-700 bg-red-50 p-4 dark:border-red-500 dark:bg-red-900/20"
        >
          <h2 className="text-base font-bold text-red-800 dark:text-red-200">IMPORTANT NOTICE</h2>
          <p className="mt-1 text-sm text-red-900 dark:text-red-100">
            The first names listed on the screens below are presented STRICTLY for the purposes of prayer, and
            they will not be stored by AFJ in any form beyond{' '}
            {noticeDateLabel ? (
              <span className="whitespace-nowrap font-bold">{noticeDateLabel}</span>
            ) : (
              'the end of next week'
            )}
            .
          </p>
        </div>

        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Campaign Results</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Results recorded for the past week&apos;s campaigns, all states.
        </p>
        {!inApp && pages && pages.length > 0 && (
          <p className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-base font-medium text-blue-900 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-100">
            <span className="font-bold">Tap a page below</span> to view it full screen. Tap anywhere (or the{' '}
            <span className="font-bold">Close</span> button) to come back.
          </p>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
            {error}
          </div>
        )}

        {!error && pages === null && (
          <div className="mt-6">
            <LoadingSpinner text={progress} />
          </div>
        )}

        {!error && pages !== null && pages.length === 0 && (
          <div className="mt-4 rounded-lg border-2 border-gray-800 bg-white p-4 text-sm text-gray-600 shadow-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400">
            No results have been recorded for the past week yet.
          </div>
        )}

        {pages && pages.length > 0 && (
          <div className="mt-4 space-y-8">
            {pages.map((page, i) => (
              <div key={page.imgUrl}>
                <div className="flex flex-wrap items-start gap-2">
                  {!inApp && (
                    <SaveImageButton
                      blob={page.blob}
                      filename={page.filename}
                      label={pages.length > 1 ? `Save Page ${i + 1} to Photos` : 'Save to Photos'}
                      className="rounded-md bg-green-600 px-4 py-2 text-base font-bold text-white hover:bg-green-700 disabled:opacity-50 border-2 border-gray-800 dark:border-gray-600"
                    />
                  )}
                  <a
                    href={page.imgUrl}
                    download={page.filename}
                    className="inline-block rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 border-2 border-gray-800 dark:border-gray-600"
                  >
                    {inApp ? `Download a Copy of Page ${i + 1}` : `Download JPEG for Page ${i + 1}`}
                  </a>
                </div>
                <div className="relative mt-4">
                  {/* eslint-disable-next-line @next/next/no-img-element -- object URL, not an optimizable static/remote asset */}
                  <img
                    src={page.imgUrl}
                    alt={`Campaign results, page ${i + 1}`}
                    onClick={() => setFullscreenPage(i)}
                    className="w-full cursor-zoom-in rounded-lg border-2 border-gray-800 shadow-sm dark:border-gray-600"
                  />
                  <button
                    type="button"
                    onClick={() => setFullscreenPage(i)}
                    className="absolute bottom-3 right-3 rounded-full border-2 border-gray-800 bg-yellow-100 px-4 py-2 text-base font-bold text-gray-900 shadow"
                  >
                    Tap to enlarge
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {onClose && <ReturnLink onClose={onClose} />}
      </div>

      {pages && fullscreenPage !== null && pages[fullscreenPage] && (
        <FullscreenImageViewer
          src={pages[fullscreenPage].imgUrl}
          alt={`Campaign results, page ${fullscreenPage + 1}`}
          onClose={() => setFullscreenPage(null)}
        />
      )}
    </div>
  );
}

function ReturnLink({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="my-3 block py-1 text-base font-bold text-blue-600 underline hover:text-blue-800 focus:outline-none dark:text-blue-400 dark:hover:text-blue-300"
    >
      ← Return to the previous page
    </button>
  );
}
