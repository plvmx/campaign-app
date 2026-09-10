'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { registrySupabase } from '@/lib/registrySupabaseClient';
import { useRegistryGate } from '@/app/registry/useRegistryGate';
import { isNationalRegistryAdmin, type MfaGateResult } from '@/lib/registryPipeline/mfaGate';
import type { ManageSummaryResponse, SyncLogSummary } from '@/lib/registryPipeline/manageSummaryTypes';
import {
  FILTER_PERIOD_OPTIONS,
  MANAGE_CONSOLE_STATES,
  countAllRegistrants,
  countRegistrantsForPeriod,
  type FilterPeriod,
  type PeriodCounts,
} from '@/lib/registryPipeline/registrantCounts';
import { getSlideStateShade } from '@/lib/slideLayout';

const ALLOW: MfaGateResult[] = ['ok'];

const cellStyle: CSSProperties = { border: '1px solid #ccc', padding: '0.6rem 0.75rem', textAlign: 'center' };
const headerCellStyle: CSSProperties = { ...cellStyle, fontWeight: 600, background: '#f3f4f6' };
const labelCellStyle: CSSProperties = { ...cellStyle, textAlign: 'left', fontWeight: 600, background: '#f3f4f6' };

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

function statusLabel(sync: SyncLogSummary): string {
  switch (sync.status) {
    case 'success': return 'Completed successfully';
    case 'failed': return 'Failed';
    case 'partial': return 'Stopped partway (time budget) — resumes next run';
    case 'crashed': return 'Crashed before completion';
    default: return sync.completedAt ? 'Completed (pre-status rows)' : 'Still running, or crashed without recording an outcome';
  }
}

function statusColor(sync: SyncLogSummary): string {
  switch (sync.status) {
    case 'success': return '#15803d';
    case 'failed':
    case 'crashed': return '#b91c1c';
    case 'partial': return '#b45309';
    default: return '#6b7280';
  }
}

/** One row of the console grid: a label, an optional period selector, and the resulting counts. */
function ConsoleRow({
  label,
  period,
  onPeriodChange,
  counts,
}: {
  label: string;
  period: FilterPeriod | null;
  onPeriodChange?: (period: FilterPeriod) => void;
  counts: PeriodCounts | null;
}) {
  return (
    <tr>
      <td style={labelCellStyle}>{label}</td>
      <td style={{ ...cellStyle, background: '#f9fafb' }}>
        {period && onPeriodChange ? (
          <select
            aria-label={`${label} period`}
            value={period}
            onChange={(e) => onPeriodChange(e.target.value as FilterPeriod)}
            style={{ padding: '0.3rem', width: '100%' }}
          >
            {FILTER_PERIOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        ) : null}
      </td>
      <td style={{ ...cellStyle, fontWeight: 600 }}>{counts ? counts.total.toLocaleString('en-AU') : '—'}</td>
      {MANAGE_CONSOLE_STATES.map((state) => (
        <td key={state} style={{ ...cellStyle, background: getSlideStateShade(state) }}>
          {counts ? counts.byState[state].toLocaleString('en-AU') : '—'}
        </td>
      ))}
      <td style={cellStyle}>{counts ? counts.unknown.toLocaleString('en-AU') : '—'}</td>
    </tr>
  );
}

export default function RegistryManagePage() {
  const gate = useRegistryGate(ALLOW);
  const [summary, setSummary] = useState<ManageSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [primaryPeriod, setPrimaryPeriod] = useState<FilterPeriod>('last_7_days');
  const [alternativePeriod, setAlternativePeriod] = useState<FilterPeriod>('last_month');

  const isAdmin = gate.status === 'ready' && isNationalRegistryAdmin(gate.leaderRole?.role);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data: { session } } = await registrySupabase.auth.getSession();
      if (!session) {
        setError('Session expired — please sign in again.');
        return;
      }
      const res = await fetch('/api/registry/manage-summary', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Failed to load the management summary.');
        return;
      }
      setSummary(json);
    } catch (err) {
      // Same reasoning as recent-registrations/page.tsx: worth logging (a
      // fetch/JSON failure, nothing sensitive) precisely because a 200
      // response can still fail client-side, which a generic message alone
      // wouldn't distinguish from a real network failure.
      console.error('[registry/manage] load failed:', err);
      setError('Failed to load the management summary — check the browser console for detail, or try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const rows = summary?.registrants ?? null;

  const allCounts = useMemo(() => (rows ? countAllRegistrants(rows) : null), [rows]);
  const primaryCounts = useMemo(() => (rows ? countRegistrantsForPeriod(rows, primaryPeriod) : null), [rows, primaryPeriod]);
  const alternativeCounts = useMemo(
    () => (rows ? countRegistrantsForPeriod(rows, alternativePeriod) : null),
    [rows, alternativePeriod],
  );

  if (gate.status === 'loading') return null;

  // A state_leader can technically navigate here directly (middleware only
  // enforces the MFA-gate cookies, not role) — this page's own national
  // totals aren't theirs to see, so show a plain refusal rather than the
  // console. The API independently enforces the same rule server-side.
  if (!isAdmin) {
    return (
      <div style={{ maxWidth: 700, margin: '2rem auto', padding: '0 1rem' }}>
        <h1>Registrations Management</h1>
        <p>This screen is only available to national registry admins.</p>
        <Link href="/registry">← Back to Registry</Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
      <p><Link href="/registry">← Back to Registry</Link></p>
      <h1>Registrations Management</h1>

      <div style={{ margin: '1rem 0', padding: '0.75rem 1rem', border: '1px solid #ddd', borderRadius: 6, background: '#fafafa' }}>
        {isLoading && !summary && <span>Loading…</span>}
        {summary?.lastSync ? (
          <>
            <strong>Last cron run:</strong> {formatDateTime(summary.lastSync.startedAt)}
            {' — '}
            <span style={{ color: statusColor(summary.lastSync) }}>{statusLabel(summary.lastSync)}</span>
            {summary.lastSync.recordsUpserted != null && (
              <span>, {summary.lastSync.recordsUpserted.toLocaleString('en-AU')} upserted</span>
            )}
            {!!summary.lastSync.errors && <span>, {summary.lastSync.errors} error(s)</span>}
          </>
        ) : (
          summary && <span>No cron runs recorded yet.</span>
        )}
      </div>

      {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}

      {summary && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={headerCellStyle}></th>
                  <th style={headerCellStyle}></th>
                  <th style={headerCellStyle}>Total</th>
                  {MANAGE_CONSOLE_STATES.map((state) => (
                    <th key={state} style={{ ...headerCellStyle, background: getSlideStateShade(state) }}>{state}</th>
                  ))}
                  <th style={headerCellStyle}>Unknown</th>
                </tr>
              </thead>
              <tbody>
                <ConsoleRow label="All AFJ Registrations" period={null} counts={allCounts} />
                <ConsoleRow label="Primary Filter" period={primaryPeriod} onPeriodChange={setPrimaryPeriod} counts={primaryCounts} />
                <ConsoleRow label="Alternative Filter" period={alternativePeriod} onPeriodChange={setAlternativePeriod} counts={alternativeCounts} />
              </tbody>
            </table>
          </div>
          <p style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: '0.75rem' }}>
            Counts are based on {summary.registrants.length.toLocaleString('en-AU')} registrants currently in the registry. &quot;Unknown&quot; covers registrants with no state on file, or a state outside VIC/NSW/ACT/QLD/NT/WA/SA/TAS.
            A registrant with no recorded registration date can never match Primary/Alternative Filter, but is still counted in All AFJ Registrations.
          </p>
        </>
      )}
    </div>
  );
}
