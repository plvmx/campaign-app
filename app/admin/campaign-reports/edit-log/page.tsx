'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { fetchEditLog } from '@/lib/services/campaignReportManageClient';
import type { ReportEditLogResponse } from '@/lib/campaignReportManageTypes';
import { getErrorMessage } from '@/lib/errorUtils';

const FIELD_LABELS: Record<string, string> = {
  derived_state: 'State',
  derived_location: 'Location',
  derived_place: 'Place (before 29 Oct)',
  derived_leader: 'Leader (matched)',
};

const thClass = 'border border-gray-300 bg-gray-100 px-2 py-2 text-left text-xs font-semibold dark:border-gray-600 dark:bg-gray-700';
const tdClass = 'border border-gray-300 px-2 py-1.5 align-top text-sm dark:border-gray-600';

export default function CampaignReportEditLogPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();
  const [hasAccess, setHasAccess] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReportEditLogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    if (!isAdmin) { setError('You do not have permission to access this page'); return; }
    setHasAccess(true);
  }, [isUserLoading, user, isAdmin, router]);

  const load = useCallback(async (p: number) => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchEditLog(p));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Error loading the edit log'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { if (hasAccess) load(page); }, [hasAccess, page, load]);

  if (isUserLoading || (isLoading && !data && hasAccess)) {
    return <MobileLayout><div className="flex min-h-screen items-center justify-center"><LoadingSpinner text="Loading edit log…" /></div></MobileLayout>;
  }

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <MobileLayout>
      <div className="p-4 pb-28">
        <a href="/admin/campaign-reports" className="mb-4 inline-block text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400">← Back to Campaign Reports</a>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Campaign Report Edit Log</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Every hand edit to a report&apos;s State, Location or Leader, newest first.</p>

        {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">{error}</div>}

        {data && (
          <>
            <p className="mt-4 text-sm font-medium text-gray-700 dark:text-gray-300">{data.total} edit{data.total === 1 ? '' : 's'} · page {data.page} of {pageCount}</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={thClass}>When</th><th className={thClass}>Report</th><th className={thClass}>Field</th>
                    <th className={thClass}>Was</th><th className={thClass}>Now</th><th className={thClass}>By</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((e) => (
                    <tr key={e.id}>
                      <td className={`${tdClass} whitespace-nowrap`}>{new Date(e.editedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                      <td className={tdClass}>{e.locationTyped || '—'}{e.leader ? <span className="text-gray-500"> · {e.leader}</span> : null}</td>
                      <td className={tdClass}>{FIELD_LABELS[e.field] ?? e.field}</td>
                      <td className={tdClass}>{e.oldValue ?? '—'}</td>
                      <td className={tdClass}>{e.newValue ?? '—'}</td>
                      <td className={tdClass}>{e.editedBy ?? '—'}</td>
                    </tr>
                  ))}
                  {data.entries.length === 0 && <tr><td colSpan={6} className={`${tdClass} text-center text-gray-500`}>No edits yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-center gap-3">
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-md border-2 border-gray-400 px-3 py-1.5 text-sm font-semibold disabled:opacity-40 dark:border-gray-500">← Newer</button>
              <button type="button" disabled={page >= pageCount} onClick={() => setPage(page + 1)} className="rounded-md border-2 border-gray-400 px-3 py-1.5 text-sm font-semibold disabled:opacity-40 dark:border-gray-500">Older →</button>
            </div>
          </>
        )}
      </div>
    </MobileLayout>
  );
}
