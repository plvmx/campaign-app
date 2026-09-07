'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { registrySupabase } from '@/lib/registrySupabaseClient';
import { useRegistryGate } from '@/app/registry/useRegistryGate';
import type { MfaGateResult } from '@/lib/registryPipeline/mfaGate';
import type { RecentRegistration } from '@/lib/registryPipeline/recentRegistrationTypes';
import { getSlideStateColor } from '@/lib/slideLayout';

/** Same per-state colors as the campaign results slides (lib/slideLayout.ts), lightened into a row-shading tint rather than used at full strength (which is text-color-saturated, not meant as a background). */
function stateRowShade(state: string | null): string {
  if (!state) return 'transparent';
  const rgb = getSlideStateColor(state).match(/\d+/g);
  if (!rgb) return 'transparent';
  const [r, g, b] = rgb;
  return `rgba(${r}, ${g}, ${b}, 0.14)`;
}

const ALLOW: MfaGateResult[] = ['ok'];

type SortColumn = 'firstName' | 'lastName' | 'email' | 'state' | 'postcode' | 'registeredAt';
type SortDirection = 'asc' | 'desc';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function RecentRegistrationsPage() {
  const gate = useRegistryGate(ALLOW);
  const [rows, setRows] = useState<RecentRegistration[] | null>(null);
  const [cutoff, setCutoff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [sortColumn, setSortColumn] = useState<SortColumn>('registeredAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data: { session } } = await registrySupabase.auth.getSession();
      if (!session) {
        setError('Session expired — please sign in again.');
        return;
      }
      const res = await fetch('/api/registry/recent-registrations', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Failed to load recent registrations.');
        return;
      }
      setRows(json.registrations);
      setCutoff(json.cutoff ?? null);
    } catch (err) {
      // The server can return 200 and still have the browser fail here —
      // e.g. the connection dropping partway through a large response
      // body, which surfaces as a JSON parse error, not a fetch()
      // rejection. Logging the real error (never shown to the user,
      // nothing sensitive in it — just a fetch/JSON failure) is the only
      // way to tell that apart from a genuine network failure without
      // guessing from a generic message alone.
      console.error('[recent-registrations] load failed:', err);
      setError('Failed to load recent registrations — check the browser console for detail, or try again on a stable connection.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (gate.status === 'ready') load();
  }, [gate.status, load]);

  const states = useMemo(() => {
    if (!rows) return [];
    return Array.from(new Set(rows.map((r) => r.state).filter((s): s is string => !!s))).sort();
  }, [rows]);

  const visibleRows = useMemo(() => {
    if (!rows) return [];
    const term = search.trim().toLowerCase();
    let filtered = rows;
    if (term) {
      filtered = filtered.filter((r) =>
        [r.firstName, r.lastName, r.email].some((v) => v?.toLowerCase().includes(term)),
      );
    }
    if (stateFilter) {
      filtered = filtered.filter((r) => r.state === stateFilter);
    }
    const sorted = [...filtered].sort((a, b) => {
      const av = a[sortColumn] ?? '';
      const bv = b[sortColumn] ?? '';
      const cmp = av.localeCompare(bv);
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [rows, search, stateFilter, sortColumn, sortDirection]);

  function toggleSort(column: SortColumn) {
    if (column === sortColumn) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }

  function sortIndicator(column: SortColumn): string {
    if (column !== sortColumn) return '';
    return sortDirection === 'asc' ? ' ▲' : ' ▼';
  }

  if (gate.status === 'loading') return null;

  const th = (column: SortColumn, label: string) => (
    <th
      onClick={() => toggleSort(column)}
      style={{ cursor: 'pointer', textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid #ccc', userSelect: 'none', whiteSpace: 'nowrap' }}
    >
      {label}{sortIndicator(column)}
    </th>
  );

  return (
    <div style={{ maxWidth: 900, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Recent Registrations</h1>
      <p>
        Live AC lookup — everyone who registered on or after{' '}
        <strong>{cutoff ? formatDate(cutoff) : '…'}</strong>, the cutoff of Lorraine&apos;s current spreadsheet.
        This is a temporary view until the full registrations reload is done.
      </p>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', margin: '1rem 0', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: '0.4rem', minWidth: 220 }}
        />
        <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} style={{ padding: '0.4rem' }}>
          <option value="">All states</option>
          {states.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button type="button" onClick={load} disabled={isLoading}>
          {isLoading ? 'Refreshing…' : 'Refresh'}
        </button>
        {rows && <span>{visibleRows.length} of {rows.length} shown</span>}
      </div>

      {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}
      {isLoading && !rows && <p>Loading from ActiveCampaign — this can take a little while…</p>}

      {rows && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {th('firstName', 'First name')}
                {th('lastName', 'Last name')}
                {th('email', 'Email')}
                <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid #ccc' }}>Mobile</th>
                {th('state', 'State')}
                {th('postcode', 'Postcode')}
                {th('registeredAt', 'Date registered')}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #eee', backgroundColor: stateRowShade(r.state) }}>
                  <td style={{ padding: '0.5rem' }}>{r.firstName ?? '—'}</td>
                  <td style={{ padding: '0.5rem' }}>{r.lastName ?? '—'}</td>
                  <td style={{ padding: '0.5rem' }}>{r.email ?? '—'}</td>
                  <td style={{ padding: '0.5rem' }}>{r.phone ?? '—'}</td>
                  <td style={{ padding: '0.5rem' }}>{r.state ?? '—'}</td>
                  <td style={{ padding: '0.5rem' }}>{r.postcode ?? '—'}</td>
                  <td style={{ padding: '0.5rem' }}>{formatDate(r.registeredAt)}</td>
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr><td colSpan={7} style={{ padding: '1rem', textAlign: 'center' }}>No matching registrations.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
