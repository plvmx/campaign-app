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

interface EventTypeStat { event_type: string; count: number }
interface StateStat     { user_state: string; count: number }
interface LeaderStat    { user_name: string;  count: number }
interface DailyStat     { day: string;        count: number }
interface RecentSignIn  { user_name: string | null; user_state: string | null; created_at: string }
interface TableCount    { table: string; count: number }

interface MetricsData {
  uniqueUsers:   number;
  totalEvents:   number;
  byType:        EventTypeStat[];
  byState:       StateStat[];
  topLeaders:    LeaderStat[];
  dailyActivity: DailyStat[];
  recentSignIns: RecentSignIn[];
  tableCounts:   TableCount[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

const EVENT_ICONS: Record<string, string> = {
  sign_in:               '🔑',
  campaign_create:       '➕',
  campaign_update:       '✏️',
  campaign_delete:       '🗑️',
  record_results_save:   '📝',
  generate_slides:       '🖼️',
  generate_report:       '📄',
  generate_week1:        '📅',
  weekly_refresh_manual: '🔄',
};

// Slide-matching state colours (muted for UI backgrounds)
const STATE_BG: Record<string, string> = {
  ACT: 'bg-sky-500',
  NSW: 'bg-gray-600',
  NT:  'bg-indigo-600',
  QLD: 'bg-red-500',
  SA:  'bg-green-500',
  TAS: 'bg-blue-500',
  VIC: 'bg-orange-500',
  WA:  'bg-purple-500',
};

const STATE_HEX: Record<string, string> = {
  ACT: '#0ea5e9',
  NSW: '#4b5563',
  NT:  '#4f46e5',
  QLD: '#ef4444',
  SA:  '#22c55e',
  TAS: '#3b82f6',
  VIC: '#f97316',
  WA:  '#a855f7',
};

// ---------------------------------------------------------------------------
// SVG Area/Line Chart for daily activity
// ---------------------------------------------------------------------------
function SparkAreaChart({ data, colour = '#3b82f6' }: { data: DailyStat[]; colour?: string }) {
  if (data.length < 2) return null;

  const W = 600;
  const H = 120;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 24;

  const maxVal = Math.max(1, ...data.map((d) => d.count));
  const xs = data.map((_, i) => padL + (i / (data.length - 1)) * (W - padL - padR));
  const ys = data.map((d) => padT + (1 - d.count / maxVal) * (H - padT - padB));

  const polylinePoints = xs.map((x, i) => `${x},${ys[i]}`).join(' ');
  const areaPoints = [
    `${xs[0]},${H - padB}`,
    ...xs.map((x, i) => `${x},${ys[i]}`),
    `${xs[xs.length - 1]},${H - padB}`,
  ].join(' ');

  const gradId = `spark-grad-${colour.replace('#', '')}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={colour} stopOpacity="0.35" />
          <stop offset="100%" stopColor={colour} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Horizontal grid lines */}
      {[0.25, 0.5, 0.75, 1].map((frac) => {
        const y = padT + (1 - frac) * (H - padT - padB);
        return (
          <line key={frac} x1={padL} y1={y} x2={W - padR} y2={y}
            stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4 3" />
        );
      })}

      {/* Filled area */}
      <polygon points={areaPoints} fill={`url(#${gradId})`} />

      {/* Line */}
      <polyline points={polylinePoints} fill="none" stroke={colour} strokeWidth="2.5"
        strokeLinejoin="round" strokeLinecap="round" />

      {/* Data points */}
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r="3.5" fill={colour} stroke="white" strokeWidth="1.5" />
      ))}

      {/* X-axis date labels — every other day to avoid crowding */}
      {data.map((d, i) => {
        if (data.length > 7 && i % 2 !== 0) return null;
        const date = new Date(d.day + 'T00:00:00');
        const label = date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });
        return (
          <text key={i} x={xs[i]} y={H - 4} textAnchor="middle"
            fontSize="10" fill="#9ca3af" fontFamily="sans-serif">
            {label}
          </text>
        );
      })}

      {/* Max value label */}
      <text x={padL + 2} y={padT + 2} fontSize="10" fill="#6b7280" fontFamily="sans-serif"
        dominantBaseline="hanging">
        {maxVal}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Donut chart for state distribution
// ---------------------------------------------------------------------------
function StateDonut({ data }: { data: StateStat[] }) {
  if (data.length === 0) return <p className="text-sm text-gray-500">No data.</p>;

  const total = data.reduce((s, d) => s + d.count, 0);
  const R = 80;
  const cx = 100;
  const cy = 100;
  const innerR = 46;

  // Build arc paths — use reduce so no let-variable is mutated during render
  type SliceShape = { state: string; count: number; pct: number; path: string };
  const slices = data.reduce<{ result: SliceShape[]; cursor: number }>(
    (acc, d) => {
      const angle   = (d.count / total) * 2 * Math.PI;
      const x1      = cx + R * Math.cos(acc.cursor);
      const y1      = cy + R * Math.sin(acc.cursor);
      const end     = acc.cursor + angle;
      const x2      = cx + R * Math.cos(end);
      const y2      = cy + R * Math.sin(end);
      const large   = angle > Math.PI ? 1 : 0;
      return {
        cursor: end,
        result: [
          ...acc.result,
          {
            state: d.user_state,
            count: d.count,
            pct:  Math.round((d.count / total) * 100),
            path: `M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`,
          },
        ],
      };
    },
    { result: [], cursor: -Math.PI / 2 },
  ).result;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      {/* SVG donut */}
      <svg viewBox="0 0 200 200" className="w-44 shrink-0" aria-hidden="true">
        {slices.map((s) => (
          <path key={s.state} d={s.path}
            fill={STATE_HEX[s.state] ?? '#9ca3af'}
            stroke="white" strokeWidth="2" />
        ))}
        {/* Donut hole */}
        <circle cx={cx} cy={cy} r={innerR} fill="white" className="dark:fill-gray-800" />
        <text x={cx} y={cy - 6}  textAnchor="middle" fontSize="22" fontWeight="bold"
          fill="#1f2937" fontFamily="sans-serif">{total}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="10"
          fill="#6b7280" fontFamily="sans-serif">events</text>
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 sm:flex-col">
        {slices.map((s) => (
          <div key={s.state} className="flex items-center gap-2 text-sm">
            <span className="h-3 w-3 shrink-0 rounded-full"
              style={{ background: STATE_HEX[s.state] ?? '#9ca3af' }} />
            <span className={`rounded px-1.5 py-0.5 text-xs font-bold text-white ${STATE_BG[s.state] ?? 'bg-gray-500'}`}>
              {s.state}
            </span>
            <span className="text-gray-700 dark:text-gray-300">{s.count}</span>
            <span className="text-gray-400">({s.pct}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horizontal bar row
// ---------------------------------------------------------------------------
function HBar({
  label, sublabel, count, max, colour = 'bg-blue-500', icon,
}: {
  label: string; sublabel?: string; count: number; max: number;
  colour?: string; icon?: string;
}) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3 py-1.5">
      {icon && <span className="text-base w-5 text-center shrink-0">{icon}</span>}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between mb-1">
          <span className="truncate text-sm text-gray-800 dark:text-gray-200">{label}</span>
          {sublabel && <span className="ml-2 shrink-0 text-xs text-gray-400">{sublabel}</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-3 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
            <div className={`h-3 rounded-full ${colour} transition-all duration-500`}
              style={{ width: `${Math.max(pct, 2)}%` }} />
          </div>
          <span className="w-8 shrink-0 text-right text-xs font-bold text-gray-700 dark:text-gray-300">{count}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section card wrapper
// ---------------------------------------------------------------------------
function Section({ title, icon, children }: { title: string; icon?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border-2 border-gray-800 dark:border-gray-600 bg-white shadow dark:bg-gray-800 overflow-hidden">
      <div className="border-b-2 border-gray-800 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 px-4 py-3 flex items-center gap-2">
        {icon && <span className="text-lg">{icon}</span>}
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 dark:text-gray-300">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------
function StatCard({ label, value, icon, colour }: {
  label: string; value: number; icon: string; colour: string;
}) {
  return (
    <div className={`rounded-xl border-2 border-gray-800 dark:border-gray-600 ${colour} p-4`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-white/80">{label}</p>
          <p className="mt-1 text-4xl font-extrabold text-white">{value.toLocaleString()}</p>
        </div>
        <span className="text-3xl opacity-80">{icon}</span>
      </div>
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

      // Top leaders
      const leaderMap: Record<string, number> = {};
      for (const r of rows) {
        if (r.user_name) leaderMap[r.user_name] = (leaderMap[r.user_name] ?? 0) + 1;
      }
      const topLeaders: LeaderStat[] = Object.entries(leaderMap)
        .map(([user_name, count]) => ({ user_name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Daily activity (up to 14 days)
      const daysToShow = Math.min(days, 14);
      const dayMap: Record<string, number> = {};
      for (let i = daysToShow - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        dayMap[d.toISOString().slice(0, 10)] = 0;
      }
      for (const r of rows) {
        const day = r.created_at.slice(0, 10);
        if (day in dayMap) dayMap[day] = (dayMap[day] ?? 0) + 1;
      }
      const dailyActivity: DailyStat[] = Object.entries(dayMap)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([day, count]) => ({ day, count }));

      // Recent sign-ins
      const recentSignIns: RecentSignIn[] = rows
        .filter((r) => r.event_type === 'sign_in')
        .slice(0, 20)
        .map((r) => ({ user_name: r.user_name, user_state: r.user_state, created_at: r.created_at }));

      // Table row counts
      const tables = ['campaigns', 'state_leaders', 'results',
        'campaign_changes_log', 'app_events', 'campaign_rules', 'campaign_categories'];
      const tableCounts = await Promise.all(
        tables.map(async (t) => {
          const { count } = await supabase.from(t).select('*', { count: 'exact', head: true });
          return { table: t, count: count ?? 0 };
        })
      );

      setMetrics({ uniqueUsers, totalEvents: rows.length, byType, byState,
        topLeaders, dailyActivity, recentSignIns, tableCounts });
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load metrics'));
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  function formatDateTime(iso: string) {
    return new Date(iso).toLocaleString('en-AU', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  const maxType   = Math.max(1, ...(metrics?.byType.map((t) => t.count)    ?? [1]));
  const maxLeader = Math.max(1, ...(metrics?.topLeaders.map((l) => l.count) ?? [1]));

  // -------------------------------------------------------------------------
  // Render
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
      <div className="p-4 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">📊 Metrics</h1>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">Usage and resource overview</p>
          </div>
          <button
            onClick={() => router.push('/admin')}
            className="rounded-md bg-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
          >
            ← Admin
          </button>
        </div>

        {/* Date range */}
        <div className="flex gap-2">
          {([7, 30, 90] as DateRange[]).map((d) => (
            <button key={d} onClick={() => handleRangeChange(d)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold border-2 border-gray-800 dark:border-gray-600 transition-colors ${
                dateRange === d
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
              }`}>
              {d === 7 ? '7 days' : d === 30 ? '30 days' : '90 days'}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {isLoading && (
          <div className="py-16 text-center text-gray-400">
            <div className="text-4xl mb-3">📊</div>
            <p>Loading metrics…</p>
          </div>
        )}

        {!isLoading && metrics && (
          <>
            {/* ── Stat cards ── */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Unique users"  value={metrics.uniqueUsers}  icon="👥" colour="bg-blue-600" />
              <StatCard label="Total events"  value={metrics.totalEvents}  icon="⚡" colour="bg-purple-600" />
              <StatCard label="Sign-ins"      icon="🔑" colour="bg-green-600"
                value={metrics.byType.find((t) => t.event_type === 'sign_in')?.count ?? 0} />
              <StatCard label="Results saved" icon="📝" colour="bg-orange-500"
                value={metrics.byType.find((t) => t.event_type === 'record_results_save')?.count ?? 0} />
            </div>

            {/* ── Daily activity chart ── */}
            <Section title={`Daily activity — last ${Math.min(dateRange, 14)} days`} icon="📈">
              {metrics.dailyActivity.every((d) => d.count === 0) ? (
                <p className="text-sm text-gray-500 py-4 text-center">No events in this period.</p>
              ) : (
                <SparkAreaChart data={metrics.dailyActivity} colour="#3b82f6" />
              )}
            </Section>

            {/* ── Events by type ── */}
            <Section title="Events by type" icon="⚡">
              {metrics.byType.length === 0 ? (
                <p className="text-sm text-gray-500">No events in this period.</p>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {metrics.byType.map(({ event_type, count }) => (
                    <HBar key={event_type}
                      label={EVENT_LABELS[event_type] ?? event_type}
                      icon={EVENT_ICONS[event_type]}
                      count={count} max={maxType}
                      colour="bg-purple-500" />
                  ))}
                </div>
              )}
            </Section>

            {/* ── State distribution donut ── */}
            <Section title="Activity by state" icon="🗺️">
              <StateDonut data={metrics.byState} />
            </Section>

            {/* ── Top leaders ── */}
            <Section title="Most active leaders" icon="🏆">
              {metrics.topLeaders.length === 0 ? (
                <p className="text-sm text-gray-500">No events in this period.</p>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {metrics.topLeaders.map(({ user_name, count }, i) => (
                    <HBar key={user_name}
                      label={user_name}
                      sublabel={`#${i + 1}`}
                      count={count} max={maxLeader}
                      colour={i === 0 ? 'bg-yellow-500' : i === 1 ? 'bg-gray-400' : i === 2 ? 'bg-orange-400' : 'bg-blue-400'} />
                  ))}
                </div>
              )}
            </Section>

            {/* ── Recent sign-ins ── */}
            <Section title="Recent sign-ins" icon="🔑">
              {metrics.recentSignIns.length === 0 ? (
                <p className="text-sm text-gray-500">No sign-ins in this period.</p>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {metrics.recentSignIns.map((s, i) => (
                    <div key={i} className="flex items-center justify-between py-2.5 gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-8 w-8 shrink-0 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-sm font-bold text-blue-700 dark:text-blue-300">
                          {(s.user_name ?? '?')[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
                            {s.user_name ?? '—'}
                          </p>
                          {s.user_state && (
                            <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-bold text-white ${STATE_BG[s.user_state] ?? 'bg-gray-500'}`}>
                              {s.user_state}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-gray-400">{formatDateTime(s.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* ── Database row counts ── */}
            <Section title="Database — row counts" icon="🗄️">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {metrics.tableCounts.map(({ table, count }) => (
                  <div key={table}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3">
                    <p className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate">{table}</p>
                    <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
                      {count.toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </Section>

            {/* ── Infrastructure ── */}
            <Section title="Infrastructure dashboards" icon="🔗">
              <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
                For detailed hosting, bandwidth, and database storage metrics:
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-emerald-600 px-4 py-3 text-base font-bold text-white hover:bg-emerald-700">
                  <span>⚡</span> Supabase ↗
                </a>
                <a href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-gray-900 px-4 py-3 text-base font-bold text-white hover:bg-gray-700">
                  <span>▲</span> Vercel ↗
                </a>
              </div>
            </Section>

          </>
        )}
      </div>
    </MobileLayout>
  );
}
