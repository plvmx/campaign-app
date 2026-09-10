'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { registrySupabase } from '@/lib/registrySupabaseClient';
import { useRegistryGate } from '@/app/registry/useRegistryGate';
import { isNationalRegistryAdmin, type MfaGateResult } from '@/lib/registryPipeline/mfaGate';
import type { ManageRegistrant, ManageSummaryResponse, SyncLogSummary } from '@/lib/registryPipeline/manageSummaryTypes';
import {
  FILTER_PERIOD_OPTIONS,
  MANAGE_CONSOLE_STATES,
  countAllRegistrants,
  countRegistrantsForPeriod,
  filterRegistrantsForCell,
  type ConsoleColumn,
  type FilterPeriod,
  type PeriodCounts,
} from '@/lib/registryPipeline/registrantCounts';
import { getSlideStateShade } from '@/lib/slideLayout';

const ALLOW: MfaGateResult[] = ['ok'];

// Cells (Total/Unknown) that aren't tied to a specific state color still
// need a "selected" look — a neutral accent rather than no color at all.
const NEUTRAL_HIGHLIGHT = 'rgba(37, 99, 235, 0.18)';

// A cell's records list can get long (the unfiltered Total column is every
// registrant) — capped so the pane stays scannable rather than dumping
// thousands of rows into the DOM at once.
const RECORDS_DISPLAY_LIMIT = 500;

type RowKey = 'all' | 'primary' | 'alternative';

interface SelectedCell {
  row: RowKey;
  rowLabel: string;
  column: ConsoleColumn;
  columnLabel: string;
}

const cellStyle: CSSProperties = { border: '1px solid #ccc', padding: '0.6rem 0.75rem', textAlign: 'center' };
const headerCellStyle: CSSProperties = { ...cellStyle, fontWeight: 600, background: '#f3f4f6' };
const labelCellStyle: CSSProperties = { ...cellStyle, textAlign: 'left', fontWeight: 600, background: '#f3f4f6' };
const numberButtonStyle: CSSProperties = {
  font: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
  padding: '0.15rem 0.4rem',
  borderRadius: 4,
  width: '100%',
};

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

/** Background for one grid cell: the column's state tint (or a neutral accent for Total/Unknown), boosted in intensity when this is the cell currently shown in the record pane below. */
function cellShade(column: ConsoleColumn, isSelected: boolean): string {
  const isState = (MANAGE_CONSOLE_STATES as readonly string[]).includes(column);
  if (isState) return getSlideStateShade(column, isSelected ? 0.45 : 0.14);
  return isSelected ? NEUTRAL_HIGHLIGHT : 'transparent';
}

/** One number cell in the grid — a click target when it has records, otherwise plain text. */
function CountCell({
  count,
  column,
  isSelected,
  onSelect,
}: {
  count: number | null;
  column: ConsoleColumn;
  isSelected: boolean;
  onSelect: (column: ConsoleColumn) => void;
}) {
  return (
    <td style={{ ...cellStyle, padding: '0.35rem', background: cellShade(column, isSelected) }}>
      {count === null ? (
        '—'
      ) : count > 0 ? (
        <button type="button" onClick={() => onSelect(column)} style={numberButtonStyle} aria-pressed={isSelected}>
          {count.toLocaleString('en-AU')}
        </button>
      ) : (
        <span style={{ color: '#9ca3af' }}>0</span>
      )}
    </td>
  );
}

/** One row of the console grid: a label, an optional period selector, and the resulting counts. */
function ConsoleRow({
  rowKey,
  label,
  period,
  onPeriodChange,
  counts,
  selectedCell,
  onSelectCell,
}: {
  rowKey: RowKey;
  label: string;
  period: FilterPeriod | null;
  onPeriodChange?: (period: FilterPeriod) => void;
  counts: PeriodCounts | null;
  selectedCell: SelectedCell | null;
  onSelectCell: (column: ConsoleColumn, columnLabel: string) => void;
}) {
  const isSelected = (column: ConsoleColumn) => selectedCell?.row === rowKey && selectedCell.column === column;

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
      <CountCell count={counts?.total ?? null} column="total" isSelected={isSelected('total')} onSelect={() => onSelectCell('total', 'Total')} />
      {MANAGE_CONSOLE_STATES.map((state) => (
        <CountCell
          key={state}
          count={counts?.byState[state] ?? null}
          column={state}
          isSelected={isSelected(state)}
          onSelect={() => onSelectCell(state, state)}
        />
      ))}
      <CountCell count={counts?.unknown ?? null} column="unknown" isSelected={isSelected('unknown')} onSelect={() => onSelectCell('unknown', 'Unknown')} />
    </tr>
  );
}

/** The record pane under the grid — every registrant behind the currently-selected cell, shaded per row the same way as Recent Registrations. */
function RecordsPane({ selectedCell, records, onClear }: { selectedCell: SelectedCell; records: ManageRegistrant[]; onClear: () => void }) {
  const sorted = useMemo(
    () => [...records].sort((a, b) => (b.registeredAt ?? '').localeCompare(a.registeredAt ?? '')),
    [records],
  );
  const shown = sorted.slice(0, RECORDS_DISPLAY_LIMIT);

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
          {selectedCell.rowLabel} — {selectedCell.columnLabel} ({records.length.toLocaleString('en-AU')})
        </h2>
        <button type="button" onClick={onClear} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0 }}>
          Clear selection
        </button>
      </div>

      {records.length > RECORDS_DISPLAY_LIMIT && (
        <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>
          Showing the most recent {RECORDS_DISPLAY_LIMIT.toLocaleString('en-AU')} of {records.length.toLocaleString('en-AU')} matching records — narrow with the Primary/Alternative Filter to see the rest.
        </p>
      )}

      <div style={{ overflowX: 'auto', marginTop: '0.5rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead>
            <tr>
              <th style={headerCellStyle}>First name</th>
              <th style={headerCellStyle}>Last name</th>
              <th style={headerCellStyle}>Email</th>
              <th style={headerCellStyle}>Mobile</th>
              <th style={headerCellStyle}>State</th>
              <th style={headerCellStyle}>Postcode</th>
              <th style={headerCellStyle}>Date registered</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #eee', background: getSlideStateShade(r.state) }}>
                <td style={{ padding: '0.5rem' }}>{r.firstName ?? '—'}</td>
                <td style={{ padding: '0.5rem' }}>{r.lastName ?? '—'}</td>
                <td style={{ padding: '0.5rem' }}>{r.email ?? '—'}</td>
                <td style={{ padding: '0.5rem' }}>{r.phone ?? '—'}</td>
                <td style={{ padding: '0.5rem' }}>{r.state ?? '—'}</td>
                <td style={{ padding: '0.5rem' }}>{r.postcode ?? '—'}</td>
                <td style={{ padding: '0.5rem' }}>{formatDateTime(r.registeredAt)}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={7} style={{ padding: '1rem', textAlign: 'center' }}>No matching records.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function RegistryManagePage() {
  const gate = useRegistryGate(ALLOW);
  const [summary, setSummary] = useState<ManageSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [primaryPeriod, setPrimaryPeriod] = useState<FilterPeriod>('last_7_days');
  const [alternativePeriod, setAlternativePeriod] = useState<FilterPeriod>('last_month');
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);

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

  // Selection is pinned by cell identity (row + column), not by a snapshot
  // of the period at click time — so if the admin leaves a cell selected
  // and then changes that row's filter dropdown, the pane's records
  // recompute against the new period automatically, the same way the
  // grid's own count for that cell does.
  const selectedPeriod: FilterPeriod | null =
    selectedCell?.row === 'primary' ? primaryPeriod : selectedCell?.row === 'alternative' ? alternativePeriod : null;

  const selectedRecords = useMemo(() => {
    if (!selectedCell || !rows) return [];
    return filterRegistrantsForCell(rows, selectedCell.column, selectedPeriod);
  }, [rows, selectedCell, selectedPeriod]);

  function selectCell(row: RowKey, rowLabel: string) {
    return (column: ConsoleColumn, columnLabel: string) => {
      setSelectedCell({ row, rowLabel, column, columnLabel });
    };
  }

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
                <ConsoleRow
                  rowKey="all"
                  label="All AFJ Registrations"
                  period={null}
                  counts={allCounts}
                  selectedCell={selectedCell}
                  onSelectCell={selectCell('all', 'All AFJ Registrations')}
                />
                <ConsoleRow
                  rowKey="primary"
                  label="Primary Filter"
                  period={primaryPeriod}
                  onPeriodChange={setPrimaryPeriod}
                  counts={primaryCounts}
                  selectedCell={selectedCell}
                  onSelectCell={selectCell('primary', 'Primary Filter')}
                />
                <ConsoleRow
                  rowKey="alternative"
                  label="Alternative Filter"
                  period={alternativePeriod}
                  onPeriodChange={setAlternativePeriod}
                  counts={alternativeCounts}
                  selectedCell={selectedCell}
                  onSelectCell={selectCell('alternative', 'Alternative Filter')}
                />
              </tbody>
            </table>
          </div>
          <p style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: '0.75rem' }}>
            Counts are based on {summary.registrants.length.toLocaleString('en-AU')} registrants currently in the registry. &quot;Unknown&quot; covers registrants with no state on file, or a state outside VIC/NSW/ACT/QLD/NT/WA/SA/TAS.
            A registrant with no recorded registration date can never match Primary/Alternative Filter, but is still counted in All AFJ Registrations. Click any non-zero number to list its records below.
          </p>

          {selectedCell ? (
            <RecordsPane selectedCell={selectedCell} records={selectedRecords} onClear={() => setSelectedCell(null)} />
          ) : (
            <p style={{ color: '#6b7280', marginTop: '1.5rem' }}>Click a number above to list the matching records here.</p>
          )}
        </>
      )}
    </div>
  );
}
