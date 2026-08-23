'use client';

/**
 * Public, unauthenticated "Final AFJ Campaign Lists" page — a read-only view
 * of the same fortnight shown on /public/temporary-upcoming-campaigns, once
 * leaders are done making changes there. Same list display and data source,
 * but Download-only (no Edit button, no leader instructions) — see that
 * page's client component for the fuller variant.
 *
 * Deliberately does NOT use MobileLayout — that component resolves the
 * signed-in user's admin status and assumes a logged-in session.
 *
 * Split out of page.tsx (a Server Component, for its `metadata` export —
 * a 'use client' page can't export metadata) — see page.tsx.
 */
import { useEffect, useState } from 'react';
import LoadingSpinner from '@/components/LoadingSpinner';
import PublicCampaignList from '@/components/PublicCampaignList';
import { getErrorMessage } from '@/lib/errorUtils';
import { generateAndDownloadSlidesFromData, type PublicSlideDay } from '@/lib/slideGenerator';
import type { AriseCampaign } from '@/lib/ariseLayout';
import type { FinalCampaignListsResponse } from '@/app/api/public/final-campaign-lists/route';

const TITLE = 'Final AFJ Campaign Lists';
const DESCRIPTION = 'Here are the final campaign lists for this fortnight';

export default function FinalCampaignListsClient() {
  const [days, setDays] = useState<PublicSlideDay[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState('');
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/public/final-campaign-lists');
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || 'Failed to load campaign data');
        if (cancelled) return;
        setDays((json as FinalCampaignListsResponse).days);
      } catch (err) {
        if (!cancelled) setLoadError(getErrorMessage(err, 'Failed to load campaign data'));
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const campaigns: AriseCampaign[] = (days ?? []).flatMap((d) => d.campaigns);

  const handleDownload = async () => {
    if (!days) return;
    setIsDownloading(true);
    setDownloadError(null);
    setDownloadProgress('');
    try {
      await generateAndDownloadSlidesFromData(days, setDownloadProgress);
    } catch (err) {
      setDownloadError(getErrorMessage(err, 'Failed to generate the campaign list download'));
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="flex h-[calc(100dvh-var(--pwa-banner-height,0px))] flex-col p-4">
      <div className="mb-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{TITLE}</h1>
        <p className="mt-1 text-base text-gray-600 dark:text-gray-400">{DESCRIPTION}</p>
      </div>

      {loadError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
          {loadError}
        </div>
      )}
      {downloadError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
          {downloadError}
        </div>
      )}

      {/* Campaign lines box — the list scrolls inside here so the button
          below always stays visible on screen. */}
      <div className="relative flex-1 overflow-hidden rounded-lg border-2 border-gray-800 dark:border-gray-600">
        {days === null && !loadError && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80 dark:bg-gray-900/80">
            <LoadingSpinner text="Loading campaigns…" />
          </div>
        )}
        <div className="h-full overflow-y-auto">
          <PublicCampaignList campaigns={campaigns} />
        </div>
      </div>

      {/* Bottom action button — outside the campaign lines box, full width. */}
      <div className="mt-3 flex shrink-0 flex-col gap-2">
        {isDownloading && downloadProgress && (
          <p className="text-center text-xs text-gray-600 dark:text-gray-400">{downloadProgress}</p>
        )}
        <button
          type="button"
          onClick={handleDownload}
          disabled={!days || isDownloading}
          className="w-full rounded-md bg-blue-600 px-4 py-3 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
        >
          {isDownloading ? 'Preparing…' : 'Download'}
        </button>
      </div>
    </div>
  );
}
