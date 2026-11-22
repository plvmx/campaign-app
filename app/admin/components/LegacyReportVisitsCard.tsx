'use client';

import { useEffect, useState } from 'react';
import { getErrorMessage } from '@/lib/errorUtils';
import { fetchLegacyReportVisitSummary } from '@/lib/services/legacyReportVisitClient';
import type { LegacyReportVisitSummary } from '@/lib/legacyReportVisits';

/**
 * Admin hub card: how many leaders are still arriving from the old campaign
 * results report (visits to /public/campaign-reporting-moved).
 */
export default function LegacyReportVisitsCard() {
  const [summary, setSummary] = useState<LegacyReportVisitSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLegacyReportVisitSummary()
      .then((s) => { if (!cancelled) setSummary(s); })
      .catch((err) => { if (!cancelled) setError(getErrorMessage(err)); });
    return () => { cancelled = true; };
  }, []);

  const stat = (label: string, value: number) => (
    <div className="rounded-md border border-gray-300 p-2 text-center dark:border-gray-600">
      <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</div>
      <div className="text-xs text-gray-600 dark:text-gray-400">{label}</div>
    </div>
  );

  return (
    <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Old campaign report: leaders still using it</h2>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        Visits to the &quot;Campaign reporting has moved&quot; page that the old report link sends leaders to.
      </p>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      {!error && !summary && <p className="mt-3 text-sm text-gray-500">Loading…</p>}
      {summary && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stat('Last 7 days', summary.last7Days)}
            {stat('Last 30 days', summary.last30Days)}
            {stat('All time', summary.totalVisits)}
            {stat('Different devices', summary.uniqueDevices)}
          </div>
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
            Last visit: {summary.lastVisitAt ? new Date(summary.lastVisitAt).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' }) : 'none yet'}
          </p>
          <details className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            <summary className="cursor-pointer">Visits per day (last 14 days)</summary>
            <ul className="mt-1">
              {[...summary.daily].reverse().map((d) => (
                <li key={d.date}>{d.date}: {d.visits}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
