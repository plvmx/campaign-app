'use client';

import { useEffect, useState } from 'react';
import { fetchMyCampaignResults } from '@/lib/services/myCampaignResultsClient';
import type { MyCampaignResultRow } from '@/lib/services/myCampaignResultsService';
import { formatReportDate } from '@/lib/campaignReportEntry';
import { getErrorMessage } from '@/lib/errorUtils';

const cell = (n: number | null) => (n === null ? '–' : String(n));

/** "My Campaign Results" block on My Admin: every campaign report the signed-in leader led. */
export default function MyCampaignResultsCard() {
  const [results, setResults] = useState<MyCampaignResultRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Loaded only when the leader opens the block, so My Admin itself stays quick.
  useEffect(() => {
    if (!open || results !== null) return;
    let cancelled = false;
    fetchMyCampaignResults()
      .then((rows) => { if (!cancelled) setResults(rows); })
      .catch((err: unknown) => { if (!cancelled) setError(getErrorMessage(err, 'Your results could not be loaded.')); });
    return () => { cancelled = true; };
  }, [open, results]);

  return (
    <div data-ti="components/MyCampaignResultsCard.tsx" className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">My Campaign Results</h2>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        The results of every campaign you have led — date, location and the four totals.
      </p>
      {open && results && results.length > 0 && (
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          <strong>PP</strong> Partial Presentations · <strong>FP</strong> Full Presentations · <strong>SP</strong> Sinners Prayers · <strong>IR</strong> Information Requests (follow-up)
        </p>
      )}
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
        >
          Show my results
        </button>
      ) : error ? (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      ) : results === null ? (
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">Loading your results…</p>
      ) : results.length === 0 ? (
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">No campaign results found for you yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b-2 border-gray-800 dark:border-gray-600 text-gray-900 dark:text-gray-100">
                <th className="py-2 pr-2 font-semibold">Campaign Date</th>
                <th className="py-2 pr-2 font-semibold">Location</th>
                <th scope="col" title="Partial Presentations" className="py-2 pr-2 text-right font-semibold">PP</th>
                <th scope="col" title="Full Presentations" className="py-2 pr-2 text-right font-semibold">FP</th>
                <th scope="col" title="Sinners Prayers" className="py-2 pr-2 text-right font-semibold">SP</th>
                <th scope="col" title="Information Requests (follow-up)" className="py-2 text-right font-semibold">IR</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id} className="border-b border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200">
                  <td className="whitespace-nowrap py-2 pr-2">{r.campaignDate ? formatReportDate(r.campaignDate) : '–'}</td>
                  <td className="py-2 pr-2">{r.location || '–'}</td>
                  <td className="py-2 pr-2 text-right">{cell(r.partial)}</td>
                  <td className="py-2 pr-2 text-right">{cell(r.full)}</td>
                  <td className="py-2 pr-2 text-right">{cell(r.sinnersPrayers)}</td>
                  <td className="py-2 text-right">{cell(r.followUp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
