'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabaseClient';
import { useCampaignDates } from '@/contexts/CampaignDatesContext';
import { formatDateForDb } from '@/lib/campaignDates';
import { getErrorMessage } from '@/lib/errorUtils';
import { getStateColor } from '@/lib/stateColors';
import {
  fetchResultsMetrics,
  aggregateByCategory,
  aggregateByState,
  aggregateByPerson,
  RESULT_CATEGORIES,
  RESULT_CATEGORY_LABELS,
  type CampaignResultsRow,
} from '@/lib/resultsMetrics';

type ViewMode = 'total' | 'category' | 'state' | 'person' | 'campaign';

const CATEGORY_BAR_COLOR: Record<string, string> = {
  TM: 'bg-blue-500',
  P: 'bg-amber-500',
  F: 'bg-emerald-500',
  SP: 'bg-purple-500',
};

export default function ResultsMetricsPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();
  const { dates: campaignDates } = useCampaignDates();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [view, setView] = useState<ViewMode>('total');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasData, setHasData] = useState(false);
  const [rows, setRows] = useState<CampaignResultsRow[]>([]);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    if (!isAdmin) { router.push('/admin'); return; }
  }, [isUserLoading, user, isAdmin, router]);

  useEffect(() => {
    if (campaignDates && !startDate && !endDate) {
      const monday = campaignDates.pastCampaignStart;
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      setStartDate(formatDateForDb(monday));
      setEndDate(formatDateForDb(sunday));
    }
  }, [campaignDates, startDate, endDate]);

  const fetchData = async () => {
    if (!startDate || !endDate) {
      setError('Please select both start and end dates');
      return;
    }
    setIsLoading(true);
    setError(null);
    setHasData(false);

    try {
      const fetched = await fetchResultsMetrics(supabase, startDate, endDate);
      if (fetched.length === 0) {
        setError('No campaigns found in the selected date range');
        setRows([]);
        return;
      }
      setRows(fetched);
      setHasData(true);
    } catch (err) {
      setError(getErrorMessage(err, 'Error loading results metrics'));
    } finally {
      setIsLoading(false);
    }
  };

  const categoryTotals = useMemo(() => aggregateByCategory(rows), [rows]);
  const stateTotals = useMemo(() => aggregateByState(rows), [rows]);
  const personTotals = useMemo(() => aggregateByPerson(rows), [rows]);
  const grandTotal = useMemo(() => categoryTotals.reduce((sum, c) => sum + c.count, 0), [categoryTotals]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  const tabs: { key: ViewMode; label: string }[] = [
    { key: 'total', label: 'Total' },
    { key: 'category', label: 'By Category' },
    { key: 'state', label: 'By State' },
    { key: 'person', label: 'By Person' },
    { key: 'campaign', label: 'By Campaign' },
  ];

  if (isUserLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <LoadingSpinner />
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="p-4 pb-28">
        <div className="mb-6">
          <a
            href="/admin"
            className="mb-4 inline-block text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            ← Back to Admin Panel
          </a>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Results Metrics
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Names recorded against past campaigns, by category, state, and person
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Date range + fetch */}
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Date Range</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            <button
              type="button"
              onClick={fetchData}
              disabled={isLoading}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
            >
              {isLoading ? 'Loading…' : 'Load Data'}
            </button>
          </div>
        </div>

        {hasData && (
          <>
            {/* View tabs */}
            <div className="mb-4 flex gap-2 flex-wrap">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setView(t.key)}
                  className={`rounded-md px-4 py-2 text-sm font-semibold border-2 transition-colors ${
                    view === t.key
                      ? 'bg-blue-600 text-white border-blue-700'
                      : 'bg-white text-gray-700 border-gray-400 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Total view */}
            {view === 'total' && (
              <div className="space-y-4">
                <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-6 text-center dark:border-blue-700 dark:bg-blue-900/30">
                  <p className="text-5xl font-bold text-blue-700 dark:text-blue-300">{grandTotal}</p>
                  <p className="mt-2 text-base font-semibold text-blue-900 dark:text-blue-100">Total Names Recorded</p>
                  <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">across {rows.length} campaign{rows.length !== 1 ? 's' : ''}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {categoryTotals.map((c) => (
                    <div
                      key={c.category}
                      className="rounded-lg border border-gray-200 bg-white p-4 text-center dark:border-gray-700 dark:bg-gray-800"
                    >
                      <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{c.count}</p>
                      <p className="mt-1 text-xs font-medium text-gray-600 dark:text-gray-400">
                        {RESULT_CATEGORY_LABELS[c.category]}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    <span className="font-semibold">Average per campaign:</span>{' '}
                    {rows.length > 0 ? (grandTotal / rows.length).toFixed(1) : '—'}
                  </p>
                </div>
              </div>
            )}

            {/* By Category view */}
            {view === 'category' && (
              <div className="space-y-3">
                {categoryTotals.map((c) => {
                  const pct = grandTotal > 0 ? Math.round((c.count / grandTotal) * 100) : 0;
                  return (
                    <div
                      key={c.category}
                      className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
                    >
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-semibold text-gray-900 dark:text-gray-100">
                          {RESULT_CATEGORY_LABELS[c.category]}
                        </span>
                        <span className="text-gray-600 dark:text-gray-400">{c.count} ({pct}%)</span>
                      </div>
                      <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                        <div
                          className={`h-full rounded-full ${CATEGORY_BAR_COLOR[c.category]}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* By State view */}
            {view === 'state' && (
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-200">State</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-gray-200">Campaigns</th>
                      {RESULT_CATEGORIES.map((cat) => (
                        <th key={cat} className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-gray-200">{cat}</th>
                      ))}
                      <th className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-gray-200">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {stateTotals.map((s) => {
                      const stateColor = getStateColor(s.state);
                      return (
                        <tr key={s.state} className={stateColor.bg}>
                          <td className="px-4 py-3 font-semibold text-gray-900 dark:text-gray-100">{s.state}</td>
                          <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{s.campaigns}</td>
                          {RESULT_CATEGORIES.map((cat) => (
                            <td key={cat} className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{s.totals[cat]}</td>
                          ))}
                          <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-gray-100">{s.total}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-gray-100 dark:bg-gray-600">
                    <tr>
                      <td className="px-4 py-3 font-bold text-gray-900 dark:text-gray-100">Total</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-gray-100">{rows.length}</td>
                      {RESULT_CATEGORIES.map((cat) => (
                        <td key={cat} className="px-4 py-3 text-right font-bold text-gray-900 dark:text-gray-100">
                          {categoryTotals.find((c) => c.category === cat)?.count ?? 0}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-gray-100">{grandTotal}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* By Person view */}
            {view === 'person' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Names are grouped by exact spelling (case-insensitive). Typos or variant spellings will appear as separate entries.
                </p>
                <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-200">Name</th>
                        {RESULT_CATEGORIES.map((cat) => (
                          <th key={cat} className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-gray-200">{cat}</th>
                        ))}
                        <th className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-gray-200">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {personTotals.map((p) => (
                        <tr key={p.name.toLowerCase()}>
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{p.name}</td>
                          {RESULT_CATEGORIES.map((cat) => (
                            <td key={cat} className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{p.totals[cat]}</td>
                          ))}
                          <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-gray-100">{p.total}</td>
                        </tr>
                      ))}
                      {personTotals.length === 0 && (
                        <tr>
                          <td colSpan={RESULT_CATEGORIES.length + 2} className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">
                            No names recorded in this date range.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* By Campaign view */}
            {view === 'campaign' && (
              <div className="space-y-3">
                {rows.map((r) => {
                  const stateColor = getStateColor(r.state);
                  const total = RESULT_CATEGORIES.reduce((sum, cat) => sum + r.names[cat].length, 0);
                  const displayLeader = r.actualLeader || r.leader;
                  return (
                    <div
                      key={r.campaignId}
                      className={`rounded-lg border border-gray-200 dark:border-gray-700 p-4 ${stateColor.bg}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 dark:text-gray-100">
                            {r.place}, {r.state}
                          </p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">{formatDate(r.date)}</p>
                          <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                            Leader: <span className="font-medium">{displayLeader}</span>
                          </p>
                          {RESULT_CATEGORIES.map((cat) => (
                            r.names[cat].length > 0 && (
                              <p key={cat} className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">
                                {RESULT_CATEGORY_LABELS[cat]}: {r.names[cat].join(', ')}
                              </p>
                            )
                          ))}
                          {total === 0 && (
                            <p className="text-sm italic text-gray-500 dark:text-gray-400 mt-0.5">No results recorded</p>
                          )}
                        </div>
                        <div className="flex-shrink-0 text-right">
                          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{total}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">name{total !== 1 ? 's' : ''}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="rounded-lg border-2 border-gray-400 bg-gray-100 dark:border-gray-600 dark:bg-gray-700 px-4 py-3 flex justify-between items-center">
                  <span className="font-bold text-gray-900 dark:text-gray-100">Total</span>
                  <span className="text-xl font-bold text-gray-900 dark:text-gray-100">{grandTotal} names</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </MobileLayout>
  );
}
