'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabaseClient';
import { getErrorMessage } from '@/lib/errorUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DateRange = 7 | 30 | 90;

interface EventTypeStat  { event_type: string;  count: number }
interface StateStat      { user_state: string;   count: number }
interface LeaderStat     { user_name: string;    count: number }
interface DailyStat      { day: string;          count: number }
interface RecentSignIn   { user_name: string | null; user_state: string | null; created_at: string }
interface TableCount     { table: string; count: number }

interface MetricsData {
  uniqueUsers:    number;
  totalEvents:    number;
  byType:         EventTypeStat[];
  byState:        StateStat[];
  topLeaders:     LeaderStat[];
  dailyActivity:  DailyStat[];
  recentSignIns:  RecentSignIn[];
  tableCounts:    TableCount[];
}

// Human-readable labels for event types
const EVENT_LABELS: Record<string, string> = {
  sign_in:               'Sign-ins',
  campaign_create:       'Campaigns created',
  campaign_update:       'Campaigns updated',
  campaign_delete:       'Campaigns deleted',
  record_results_save:   'Results recorded',
  generate_slides:       'Campaign Lists generated',
  generate_report:       'Reports generated',
  generate_week1:        'Week 1 Lists generated',
  weekly_refresh_manual: 'Manual weekly refreshes',
};

// ---------------------------------------------------------------------------
// Helper: simple CSS percentage bar
// ---------------------------------------------------------------------------
function Bar({ pct, colour = 'bg-blue-500' }: { pct: number; colour?: string }) {
  return (
    <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
      <div
        className={`h-2 rounded-full ${colour}`}
        style={{ width: `${Math.max(pct, 2)}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: section wrapper
// ---------------------------------------------------------------------------
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white shadow-sm dark:bg-gray-800 overflow-hidden">
      <div className="border-b-2 border-gray-800 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 px-4 py-3">
        <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function MetricsPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();

  const [dateRange, setDateRange] = useState<DateRange>(30);
  const [metrics, setMetrics]     = useState<MetricsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]         = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------
  const fetchMetrics = useCallback(async (days: DateRange) => {
    setIsLoading(true);
    setError(null);
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const sinceStr = since.toISOString();

      // All events in the window
      const { data: events, error: eventsErr } = await supabase
        .from('app_events')
        .select('event_type, user_name, user_state, created_at')
        .gte('created_at', sinceStr)
        .order('created_at', { ascending: false });
      if (eventsErr) throw eventsErr;
      const rows = events ?? [];

      // Unique users
      const uniqueUsers = new Set(rows.map((r) => r.user_name).filter(Boolean)).size;

      // By type
      const typeMap: Record<string, number> = {};
      for (const r of rows) typeMap[r.event_type] = (typeMap[r.event_type] ?? 0) + 1;
      const byType: EventTypeStat[] = Object.entries(typeMap)
        .map(([event_type, count]) => ({ event_type, count }))
        .sort((a, b) => b.count - a.count);

      // By state
      const stateMap: Record<string, number> = {};
      for (const r of rows) {
        if (r.user_state) stateMap[r.user_state] = (stateMap[r.user_state] ?? 0) + 1;
      }
      const byState: StateStat[] = Object.entries(stateMap)
        .map(([user_state, count]) => ({ user_state, count }))
        .sort((a, b) => b.count - a.count);

      // Top leaders (by total events)
      const leaderMap: Record<string, number> = {};
      for (const r of rows) {
        if (r.user_name) leaderMap[r.user_name] = (leaderMap[r.user_name] ?? 0) + 1;
      }
      const topLeaders: LeaderStat[] = Object.entries(leaderMap)
        .map(([user_name, count]) => ({ user_name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Daily activity (last 14 days, capped by the chosen window)
      const dayMap: Record<string, number> = {};
      const daysToShow = Math.min(days, 14);
      for (let i = 0; i < daysToShow; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        dayMap[d.toISOString().slice(0, 10)] = 0;
      }
      for (const r of rows) {
        const day = r.created_at.slice(0, 10);
        if (day in dayMap) dayMap[day] = (dayMap[day] ?? 0) + 1;
      }
      const dailyActivity: DailyStat[] = Object.entries(dayMap)
        .map(([day, count]) => ({ day, count }))
        .sort((a, b) => a.day.localeCompare(b.day));

      // Recent sign-ins
      const recentSignIns: RecentSignIn[] = rows
        .filter((r) => r.event_type === 'sign_in')
        .slice(0, 20)
        .map((r) => ({ user_name: r.user_name, user_state: r.user_state, created_at: r.created_at }));

      // Table row counts
      const tables = [
        'campaigns',
        'state_leaders',
        'results',
        'campaign_changes_log',
        'app_events',
        'campaign_rules',
        'campaign_categories',
      ];
      const countResults = await Promise.all(
        tables.map(async (t) => {
          const { count } = await supabase.from(t).select('*', { count: 'exact', head: true });
          return { table: t, count: count ?? 0 };
        })
      );

      setMetrics({
        uniqueUsers,
        totalEvents: rows.length,
        byType,
        byState,
        topLeaders,
        dailyActivity,
        recentSignIns,
        tableCounts: countResults,
      });
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load metrics'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Auth guard
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    if (!isAdmin) { router.push('/admin'); return; }
    fetchMetrics(dateRange);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUserLoading, user, isAdmin]);

  const handleRangeChange = (days: DateRange) => {
    setDateRange(days);
    fetchMetrics(days);
  };

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------
  function formatDateTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString('en-AU', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function formatDate(iso: string) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });
  }

  const maxDailyCount = Math.max(1, ...(metrics?.dailyActivity.map((d) => d.count) ?? [1]));
  const maxTypeCount  = Math.max(1, ...(metrics?.byType.map((t) => t.count) ?? [1]));
  const maxStateCount = Math.max(1, ...(metrics?.byState.map((s) => s.count) ?? [1]));
  const maxLeaderCount = Math.max(1, ...(metrics?.topLeaders.map((l) => l.count) ?? [1]));

  // -------------------------------------------------------------------------
  // Loading / error states
  // -------------------------------------------------------------------------
  if (isUserLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-gray-600 dark:text-gray-400">Loading…</div>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="p-4 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Metrics</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Usage and resource overview
            </p>
          </div>
          <button
            onClick={() => router.push('/admin')}
            className="rounded-md bg-gray-200 px-3 py-2 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
          >
            Back
          </button>
        </div>

        {/* Date range selector */}
        <div className="flex gap-2">
          {([7, 30, 90] as DateRange[]).map((d) => (
            <button
              key={d}
              onClick={() => handleRangeChange(d)}
              className={`rounded-md px-4 py-2 text-sm font-bold border-2 border-gray-800 dark:border-gray-600 ${
                dateRange === d
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              {d === 7 ? 'Last 7 days' : d === 30 ? 'Last 30 days' : 'Last 90 days'}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200">
            {error}
          </div>
        )}

        {isLoading && (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading metrics…</div>
        )}

        {!isLoading && metrics && (
          <>
            {/* ── Section A: Usage ── */}

            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Unique users',  value: metrics.uniqueUsers  },
                { label: 'Total events',  value: metrics.totalEvents  },
                { label: 'Sign-ins',      value: metrics.byType.find((t) => t.event_type === 'sign_in')?.count ?? 0 },
                { label: 'Results saved', value: metrics.byType.find((t) => t.event_type === 'record_results_save')?.count ?? 0 },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-blue-50 dark:bg-blue-900/20 p-4 text-center">
                  <div className="text-3xl font-bold text-blue-700 dark:text-blue-300">{value}</div>
                  <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">{label}</div>
                </div>
              ))}
            </div>

            {/* Daily activity */}
            <Section title={`Daily activity (last ${Math.min(dateRange, 14)} days)`}>
              {metrics.dailyActivity.length === 0 ? (
                <p className="text-sm text-gray-500">No events in this period.</p>
              ) : (
                <div className="space-y-2">
                  {metrics.dailyActivity.map(({ day, count }) => (
                    <div key={day} className="flex items-center gap-3">
                      <span className="w-20 shrink-0 text-xs text-gray-500 dark:text-gray-400">{formatDate(day)}</span>
                      <div className="flex-1">
                        <Bar pct={(count / maxDailyCount) * 100} colour="bg-blue-500" />
                      </div>
                      <span className="w-8 text-right text-xs font-semibold text-gray-700 dark:text-gray-300">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Events by type */}
            <Section title="Events by type">
              {metrics.byType.length === 0 ? (
                <p className="text-sm text-gray-500">No events in this period.</p>
              ) : (
                <div className="space-y-2">
                  {metrics.byType.map(({ event_type, count }) => (
                    <div key={event_type} className="flex items-center gap-3">
                      <span className="w-44 shrink-0 text-xs text-gray-700 dark:text-gray-300">
                        {EVENT_LABELS[event_type] ?? event_type}
                      </span>
                      <div className="flex-1">
                        <Bar pct={(count / maxTypeCount) * 100} colour="bg-purple-500" />
                      </div>
                      <span className="w-8 text-right text-xs font-semibold text-gray-700 dark:text-gray-300">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Activity by state */}
            <Section title="Activity by state">
              {metrics.byState.length === 0 ? (
                <p className="text-sm text-gray-500">No events in this period.</p>
              ) : (
                <div className="space-y-2">
                  {metrics.byState.map(({ user_state, count }) => (
                    <div key={user_state} className="flex items-center gap-3">
                      <span className="w-12 shrink-0 text-xs font-bold text-gray-700 dark:text-gray-300">{user_state}</span>
                      <div className="flex-1">
                        <Bar pct={(count / maxStateCount) * 100} colour="bg-green-500" />
                      </div>
                      <span className="w-8 text-right text-xs font-semibold text-gray-700 dark:text-gray-300">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Most active leaders */}
            <Section title="Most active leaders (top 10)">
              {metrics.topLeaders.length === 0 ? (
                <p className="text-sm text-gray-500">No events in this period.</p>
              ) : (
                <div className="space-y-2">
                  {metrics.topLeaders.map(({ user_name, count }, i) => (
                    <div key={user_name} className="flex items-center gap-3">
                      <span className="w-5 shrink-0 text-xs text-gray-400">{i + 1}.</span>
                      <span className="w-36 shrink-0 truncate text-xs text-gray-700 dark:text-gray-300">{user_name}</span>
                      <div className="flex-1">
                        <Bar pct={(count / maxLeaderCount) * 100} colour="bg-orange-500" />
                      </div>
                      <span className="w-8 text-right text-xs font-semibold text-gray-700 dark:text-gray-300">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Recent sign-ins */}
            <Section title="Recent sign-ins">
              {metrics.recentSignIns.length === 0 ? (
                <p className="text-sm text-gray-500">No sign-ins in this period.</p>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {metrics.recentSignIns.map((s, i) => (
                    <div key={i} className="flex items-center justify-between py-2">
                      <div>
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                          {s.user_name ?? '—'}
                        </span>
                        {s.user_state && (
                          <span className="ml-2 rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-xs font-semibold text-gray-600 dark:text-gray-300">
                            {s.user_state}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">{formatDateTime(s.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* ── Section B: Database row counts ── */}
            <Section title="Database — row counts">
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {metrics.tableCounts.map(({ table, count }) => (
                  <div key={table} className="flex items-center justify-between py-2">
                    <span className="text-sm text-gray-700 dark:text-gray-300 font-mono">{table}</span>
                    <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                      {count.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </Section>

            {/* ── Section C: Infrastructure links ── */}
            <Section title="Infrastructure dashboards">
              <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
                For detailed hosting and database resource usage, open the provider dashboards directly:
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <a
                  href="https://supabase.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 rounded-md border-2 border-gray-800 dark:border-gray-600 bg-green-600 px-4 py-3 text-center text-base font-bold text-white hover:bg-green-700"
                >
                  Supabase Dashboard ↗
                </a>
                <a
                  href="https://vercel.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 rounded-md border-2 border-gray-800 dark:border-gray-600 bg-gray-900 px-4 py-3 text-center text-base font-bold text-white hover:bg-gray-700"
                >
                  Vercel Dashboard ↗
                </a>
              </div>
            </Section>
          </>
        )}
      </div>
    </MobileLayout>
  );
}
