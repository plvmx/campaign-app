'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import PickCell from '@/components/campaignReports/PickCell';
import { useUser } from '@/contexts/UserContext';
import { fetchManageData, saveReportEdit, UnknownLocationError } from '@/lib/services/campaignReportManageClient';
import type { EditableReportField, ManageReport } from '@/lib/campaignReportManageTypes';
import {
  DEFAULT_REPORT_FILTERS, filterReports, sortReports, reportYears, summarizeReports,
  type ReportFilters, type ReportSortColumn, type SortDirection,
} from '@/lib/campaignReportManageFilters';
import { getErrorMessage } from '@/lib/errorUtils';
import { AUSTRALIAN_STATES } from '@/lib/constants';

const PAGE_SIZE = 100;

type Mode = 'view' | 'edit';

const inputClass =
  'rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100';
const thClass = 'whitespace-nowrap border border-gray-300 bg-gray-100 px-2 py-2 text-left text-xs font-semibold dark:border-gray-600 dark:bg-gray-700';
const tdClass = 'border border-gray-300 px-2 py-1.5 align-top text-sm dark:border-gray-600';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function CampaignReportsManagePage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();

  const [hasAccess, setHasAccess] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reports, setReports] = useState<ManageReport[]>([]);
  const [stateLocations, setStateLocations] = useState<{ state: string; location: string }[]>([]);
  const [leaders, setLeaders] = useState<{ state: string; leader: string }[]>([]);

  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_REPORT_FILTERS);
  const [sort, setSort] = useState<{ column: ReportSortColumn; direction: SortDirection }>({ column: 'submittedAt', direction: 'desc' });
  const [mode, setMode] = useState<Mode>('view');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    if (!isAdmin) { setLoadError('You do not have permission to access this page'); return; }
    setHasAccess(true);
  }, [isUserLoading, user, isAdmin, router]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await fetchManageData();
      setReports(data.reports);
      setStateLocations(data.locations);
      setLeaders(data.leaders);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Error loading reports'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { if (hasAccess) load(); }, [hasAccess, load]);

  const years = useMemo(() => reportYears(reports), [reports]);
  const summary = useMemo(() => summarizeReports(reports), [reports]);
  const visible = useMemo(() => sortReports(filterReports(reports, filters), sort.column, sort.direction), [reports, filters, sort]);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const setFilter = <K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const toggleSort = (column: ReportSortColumn) => {
    setSort((prev) => prev.column === column
      ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: column === 'submittedAt' || column === 'campaignDate' ? 'desc' : 'asc' });
  };

  const locationsFor = useCallback((state: string | null) => (state ? stateLocations.filter((p) => p.state === state).map((p) => p.location) : []), [stateLocations]);
  const leadersFor = useCallback((state: string | null) => (state ? leaders.filter((l) => l.state === state).map((l) => l.leader) : []), [leaders]);

  const applyEdit = async (report: ManageReport, field: EditableReportField, value: string | null) => {
    let addLocation = false;
    for (;;) {
      try {
        const updated = await saveReportEdit(report.id, field, value, addLocation);
        setReports((prev) => prev.map((r) => r.id === report.id
          ? { ...r, state: updated.state, location: updated.location, matchedLeader: updated.matchedLeader } : r));
        if (addLocation && updated.location && updated.state) {
          setStateLocations((prev) => [...prev, { state: updated.state!, location: updated.location! }]);
        }
        return;
      } catch (err: unknown) {
        if (err instanceof UnknownLocationError && !addLocation
            && window.confirm(`"${value}" isn't a location in State Places for ${report.state}. Add it as a new location?\n\nIt will also appear in State Places and the campaign dropdowns.`)) {
          addLocation = true;
          continue;
        }
        throw err;
      }
    }
  };

  const sortMark = (column: ReportSortColumn) => (sort.column === column ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : '');
  const SortTh = ({ column, children }: { column: ReportSortColumn; children: string }) => (
    <th className={`${thClass} cursor-pointer select-none`} onClick={() => toggleSort(column)}>{children}{sortMark(column)}</th>
  );

  if (isUserLoading || (isLoading && hasAccess)) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center"><LoadingSpinner text="Loading reports…" /></div>
      </MobileLayout>
    );
  }

  if (!hasAccess) {
    return (
      <MobileLayout>
        <div className="p-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-200">Access Denied</h2>
            <p className="mt-1 text-sm text-red-600 dark:text-red-300">{loadError || 'You do not have permission to access this page.'}</p>
            <a href="/admin" className="mt-4 inline-block rounded-md bg-red-600 px-4 py-2 text-base font-bold text-white hover:bg-red-700 border-2 border-gray-800 dark:border-gray-600">Go Back</a>
          </div>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="p-4 pb-28">
        <a href="/admin" className="mb-4 inline-block text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400">← Back to Admin Panel</a>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Campaign Reports</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Every Campaign Report from the sheet, with the State, Location and Leader worked out from it. Search, filter and sort,
          then switch to Edit to fill in anything that is missing. Changes are logged.
        </p>

        {loadError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">{loadError}</div>
        )}

        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full border border-gray-300 px-3 py-1 dark:border-gray-600">{summary.total} reports</span>
          <button type="button" onClick={() => setFilter('state', 'none')} className="rounded-full border border-amber-400 bg-amber-50 px-3 py-1 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
            {summary.noState} with no state
          </button>
          <button type="button" onClick={() => setFilter('locationStatus', 'missing')} className="rounded-full border border-amber-400 bg-amber-50 px-3 py-1 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
            {summary.noLocation} with no location
          </button>
          <button type="button" onClick={() => setFilter('needsReviewOnly', true)} className="rounded-full border border-gray-300 px-3 py-1 dark:border-gray-600">
            {summary.needsReview} need review
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Search
            <input value={filters.search} onChange={(e) => setFilter('search', e.target.value)} placeholder="Location, leader, place…" className={`${inputClass} mt-1 block w-56`} />
          </label>
          <label className="text-xs font-medium text-gray-700 dark:text-gray-300">State
            <select value={filters.state} onChange={(e) => setFilter('state', e.target.value)} className={`${inputClass} mt-1 block`}>
              <option value="all">All</option>
              <option value="none">No state</option>
              {AUSTRALIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Location
            <select value={filters.locationStatus} onChange={(e) => setFilter('locationStatus', e.target.value as ReportFilters['locationStatus'])} className={`${inputClass} mt-1 block`}>
              <option value="all">All</option>
              <option value="missing">No location</option>
              <option value="set">Has a location</option>
            </select>
          </label>
          <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Submitted
            <select value={filters.year} onChange={(e) => setFilter('year', e.target.value)} className={`${inputClass} mt-1 block`}>
              <option value="all">All years</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={filters.needsReviewOnly} onChange={(e) => setFilter('needsReviewOnly', e.target.checked)} />
            Needs review only
          </label>
          <button type="button" onClick={() => { setFilters(DEFAULT_REPORT_FILTERS); setPage(1); }}
            className="mb-0.5 rounded-md border-2 border-gray-400 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-500 dark:bg-gray-700 dark:text-gray-300">
            Clear filters
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {visible.length} matching · page {safePage} of {pageCount}
          </p>
          <div className="flex items-center gap-2">
            <a href="/admin/campaign-reports/edit-log" className="text-sm text-blue-600 underline dark:text-blue-400">View Edit Log</a>
            <div className="flex overflow-hidden rounded-md border-2 border-gray-800 dark:border-gray-600" role="group" aria-label="View or edit">
              {(['view', 'edit'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
                  className={`px-4 py-1.5 text-sm font-bold ${mode === m ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 dark:bg-gray-700 dark:text-gray-200'}`}>
                  {m === 'view' ? 'View' : 'Edit'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <SortTh column="submittedAt">Submitted</SortTh>
                <SortTh column="campaignDate">Campaign date</SortTh>
                <SortTh column="locationTyped">Location (as typed)</SortTh>
                <SortTh column="leader">Leader (as typed)</SortTh>
                <SortTh column="state">State</SortTh>
                <SortTh column="location">Location</SortTh>
                <th className={thClass}>Leader (matched)</th>
                <th className={thClass} title="Partial presentations">PP</th>
                <th className={thClass} title="Full presentations">FP</th>
                <th className={thClass} title="Sinner's prayer">SP</th>
                <th className={thClass} title="Information requests">IR</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id} className={r.needsReview ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}>
                  <td className={`${tdClass} whitespace-nowrap`}>{formatDate(r.submittedAt)}</td>
                  <td className={`${tdClass} whitespace-nowrap`} title={r.campaignDateRaw ?? undefined}>{r.campaignDate ? formatDate(r.campaignDate) : (r.campaignDateRaw ?? '—')}</td>
                  <td className={tdClass}>{r.locationTyped || '—'}</td>
                  <td className={tdClass}>{r.leader || '—'}</td>
                  <td className={tdClass}>
                    {mode === 'edit' ? (
                      <select value={r.state ?? ''} onChange={(e) => applyEdit(r, 'state', e.target.value || null).catch((err) => window.alert(getErrorMessage(err, 'Failed to save')))} className={inputClass}>
                        <option value="">—</option>
                        {AUSTRALIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (r.state ?? '—')}
                  </td>
                  <td className={tdClass}>
                    {mode === 'edit'
                      ? <PickCell key={`${r.id}-${r.state}-${r.location}`} value={r.location} options={locationsFor(r.state)} disabled={!r.state} blankLabel="— Pick a location" disabledLabel="Choose a state first" newLabel="Add a new location…" onSave={(v) => applyEdit(r, 'location', v)} />
                      : (r.location ?? '—')}
                  </td>
                  <td className={tdClass}>
                    {mode === 'edit'
                      ? <PickCell key={`${r.id}-${r.state}-${r.matchedLeader}`} value={r.matchedLeader} options={leadersFor(r.state)} disabled={!r.state} blankLabel="— Pick a leader" disabledLabel="Choose a state first" onSave={(v) => applyEdit(r, 'leader', v)} />
                      : (r.matchedLeader ?? '—')}
                  </td>
                  <td className={`${tdClass} text-right`}>{r.partial ?? '—'}</td>
                  <td className={`${tdClass} text-right`}>{r.full ?? '—'}</td>
                  <td className={`${tdClass} text-right`}>{r.sinnersPrayer ?? '—'}</td>
                  <td className={`${tdClass} text-right`}>{r.infoRequests ?? '—'}</td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr><td colSpan={11} className={`${tdClass} text-center text-gray-500`}>No reports match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-center gap-3">
          <button type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}
            className="rounded-md border-2 border-gray-400 px-3 py-1.5 text-sm font-semibold disabled:opacity-40 dark:border-gray-500">← Previous</button>
          <span className="text-sm text-gray-700 dark:text-gray-300">Page {safePage} of {pageCount}</span>
          <button type="button" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}
            className="rounded-md border-2 border-gray-400 px-3 py-1.5 text-sm font-semibold disabled:opacity-40 dark:border-gray-500">Next →</button>
        </div>
      </div>
    </MobileLayout>
  );
}
