'use client';

/**
 * Public, unauthenticated "Temporary Upcoming Campaigns" list — a read-only
 * view of the same fortnight shown on the (authenticated) Register Interest
 * screen, minus selection/registration. Not listed in middleware's
 * PROTECTED_PREFIXES, so it's open by default (see middleware.ts).
 *
 * Deliberately does NOT use MobileLayout — that component resolves the
 * signed-in user's admin status and assumes a logged-in session.
 *
 * Split out of page.tsx (a Server Component, for its `metadata` export —
 * a 'use client' page can't export metadata) — see page.tsx.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import LoadingSpinner from '@/components/LoadingSpinner';
import PublicCampaignList from '@/components/PublicCampaignList';
import { getErrorMessage } from '@/lib/errorUtils';
import { generateAndDownloadSlidesFromData, type PublicSlideDay } from '@/lib/slideGenerator';
import type { AriseCampaign } from '@/lib/ariseLayout';
import type { TemporaryUpcomingCampaignsResponse } from '@/app/api/public/temporary-upcoming-campaigns/route';

const BODY_TEXT =
  "Here is the temporary upcoming campaign list for this fortnight. ALL LEADERS please find your campaigns and check that the details displayed are correct.  If you need to make any changes click on the green 'Edit' button at the bottom. There is also a download button if you want to keep a copy of this list.";

export default function TemporaryUpcomingCampaignsClient() {
  const router = useRouter();
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
        if (cancelled) return;
        setDays((json as TemporaryUpcomingCampaignsResponse).days);
      } catch (err) {
        if (!cancelled) setLoadError(getErrorMessage(err, 'Failed to load campaign data'));
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const campaigns: AriseCampaign[] = (days ?? []).flatMap((d) => d.campaigns);

  const handleEdit = () => {
    router.push('/login');
  };

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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Temporary Upcoming Campaigns</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{BODY_TEXT}</p>
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

      {/* Campaign lines box — the list scrolls inside here so the two
          buttons below always stay visible on screen. */}
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

      {/* Bottom action buttons — outside the campaign lines box, stretching
          the full width of the screen. */}
      <div className="mt-3 flex shrink-0 flex-col gap-2">
        {isDownloading && downloadProgress && (
          <p className="text-center text-xs text-gray-600 dark:text-gray-400">{downloadProgress}</p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleEdit}
            className="flex-1 rounded-md bg-green-600 px-4 py-3 text-base font-bold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!days || isDownloading}
            className="flex-1 rounded-md bg-blue-600 px-4 py-3 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
          >
            {isDownloading ? 'Preparing…' : 'Download'}
          </button>
        </div>
      </div>
    </div>
  );
}
