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
import { getErrorMessage } from '@/lib/errorUtils';
import { formatDownloadDate } from '@/lib/slideLayout';
import { drawReportPage, canvasToJpegBlob } from '@/lib/reportCanvas';
import { chunkReportRows } from '@/lib/reportGenerator';
import type { CampaignResultsResponse } from '@/app/api/public/campaign-results/route';

interface ResultPage {
  imgUrl: string;
  filename: string;
}

export default function CampaignResultsClient() {
  const [progress, setProgress] = useState('Loading campaign results…');
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<ResultPage[] | null>(null);
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

        const { rows } = json as CampaignResultsResponse;
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
          built.push({ imgUrl: url, filename: `${datePrefix}_Campaign_Results${suffix}.jpeg` });
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
    <div className="min-h-screen bg-gray-100 p-4 dark:bg-gray-950">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Campaign Results</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Results recorded for the past week&apos;s campaigns, all states.
        </p>

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
                <a
                  href={page.imgUrl}
                  download={page.filename}
                  className="inline-block rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 border-2 border-gray-800 dark:border-gray-600"
                >
                  Download JPEG for Page {i + 1}
                </a>
                {/* eslint-disable-next-line @next/next/no-img-element -- object URL, not an optimizable static/remote asset */}
                <img
                  src={page.imgUrl}
                  alt={`Campaign results, page ${i + 1}`}
                  onClick={() => setFullscreenPage(i)}
                  className="mt-4 w-full cursor-zoom-in rounded-lg border-2 border-gray-800 shadow-sm dark:border-gray-600"
                />
              </div>
            ))}
          </div>
        )}
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
