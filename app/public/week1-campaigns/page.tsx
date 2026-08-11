'use client';

/**
 * Public, unauthenticated "Week 1 Campaigns" list — mirrors the "All States"
 * output of the Admin Quick Actions "Week 1 Campaigns" download, but reachable
 * via a static link with no login. Not listed in middleware's PROTECTED_PREFIXES,
 * so it's open by default (see middleware.ts).
 *
 * Deliberately does NOT use MobileLayout — that component resolves the
 * signed-in user's admin status and assumes a logged-in session.
 */
import { useEffect, useRef, useState } from 'react';
import LoadingSpinner from '@/components/LoadingSpinner';
import { getErrorMessage } from '@/lib/errorUtils';
import { formatDownloadDate } from '@/lib/slideLayout';
import { renderAriseCanvas } from '@/lib/ariseCanvas';
import type { AriseCampaign } from '@/lib/ariseLayout';
import type { Week1CampaignsResponse } from '@/app/api/public/week1-campaigns/route';

/** Parses a 'YYYY-MM-DD' string as a local-midnight Date, matching how the
 * rest of the app builds dates (avoids a UTC/local off-by-one). */
function parseDbDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export default function PublicWeek1CampaignsPage() {
  const [progress, setProgress] = useState('Loading Week 1 campaign data…');
  const [error, setError] = useState<string | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const filenameRef = useRef('Week1_Campaigns.jpg');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/public/week1-campaigns');
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || 'Failed to load campaign data');
        if (cancelled) return;

        const { days } = json as Week1CampaignsResponse;
        const dates: Date[] = days.map((d) => parseDbDate(d.date));
        const allCampaigns: AriseCampaign[][] = days.map((d) => d.campaigns);

        const canvas = await renderAriseCanvas(allCampaigns, dates, (msg) => {
          if (!cancelled) setProgress(msg);
        });
        if (cancelled) return;

        setProgress('Creating image…');
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Failed to create image'))),
            'image/jpeg',
            0.95,
          );
        });
        if (cancelled) return;

        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        filenameRef.current = `${formatDownloadDate(new Date())}_Week1_Campaigns.jpg`;
        setImgUrl(url);
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err, 'Failed to load Week 1 Campaigns list'));
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 p-4 dark:bg-gray-950">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Week 1 Campaigns</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          All upcoming campaigns for this week, all states.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
            {error}
          </div>
        )}

        {!error && !imgUrl && (
          <div className="mt-6">
            <LoadingSpinner text={progress} />
          </div>
        )}

        {imgUrl && (
          <div className="mt-4">
            <a
              href={imgUrl}
              download={filenameRef.current}
              className="inline-block rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 border-2 border-gray-800 dark:border-gray-600"
            >
              Download JPEG
            </a>
            {/* Rendered at 4200×3000; scaled down for on-screen viewing. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- object URL, not an optimizable static/remote asset */}
            <img
              src={imgUrl}
              alt="Week 1 Campaigns list"
              className="mt-4 w-full rounded-lg border-2 border-gray-800 shadow-sm dark:border-gray-600"
            />
          </div>
        )}
      </div>
    </div>
  );
}
