'use client';

import { useEffect, useState } from 'react';
import LoadingSpinner from '@/components/LoadingSpinner';
import PublicCampaignList from '@/components/PublicCampaignList';
import { getErrorMessage } from '@/lib/errorUtils';
import { generateAndDownloadSlidesFromData, type PublicSlideDay } from '@/lib/slideGenerator';
import type { TemporaryUpcomingCampaignsResponse } from '@/app/api/public/temporary-upcoming-campaigns/route';

/**
 * Full-screen "Upcoming Campaigns for All Leaders" — the same fortnight list
 * as the public /public/temporary-upcoming-campaigns page (same API, same
 * PublicCampaignList), but with only a Download button and a link back to the
 * screen it was opened from. Shown in place (fixed overlay) so going back
 * returns the leader to exactly where they were on /app.
 */
export default function AllLeadersCampaignListScreen({ onClose }: { onClose: () => void }) {
  const [days, setDays] = useState<PublicSlideDay[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState('');
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/public/temporary-upcoming-campaigns');
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || 'Failed to load campaign data');
        if (!cancelled) setDays((json as TemporaryUpcomingCampaignsResponse).days);
      } catch (err) {
        if (!cancelled) setLoadError(getErrorMessage(err, 'Failed to load campaign data'));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const campaigns = (days ?? []).flatMap((d) => d.campaigns);

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
    <div
      data-ti="components/AllLeadersCampaignListScreen.tsx"
      className="fixed inset-0 z-50 flex flex-col bg-white p-4 dark:bg-gray-900"
    >
      <h1 className="mb-3 text-2xl font-bold text-gray-900 dark:text-gray-100">
        Upcoming Campaigns for All Leaders
      </h1>

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

      <div className="mt-3 flex shrink-0 flex-col gap-2">
        {isDownloading && downloadProgress && (
          <p className="text-center text-xs text-gray-600 dark:text-gray-400">{downloadProgress}</p>
        )}
        <button
          type="button"
          onClick={handleDownload}
          disabled={!days || isDownloading}
          className="w-full rounded-md border-2 border-gray-800 bg-blue-600 px-4 py-3 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600"
        >
          {isDownloading ? 'Preparing…' : 'Download a Copy'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="py-1 text-center text-base font-bold text-blue-600 underline hover:text-blue-800 focus:outline-none dark:text-blue-400 dark:hover:text-blue-300"
        >
          ← Return to the previous page
        </button>
      </div>
    </div>
  );
}
