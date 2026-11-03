'use client';

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import Link from 'next/link';
import { registrySupabase } from '@/lib/registrySupabaseClient';
import { useRegistryGate } from '@/app/registry/useRegistryGate';
import { isNationalRegistryAdmin, type MfaGateResult } from '@/lib/registryPipeline/mfaGate';
import type { RegistrationLogEntry, RegistrationLogResponse } from '@/lib/registryPipeline/manageSummaryTypes';
import {
  REGISTRATION_LOG_OUTCOME_EXPLANATIONS,
  REGISTRATION_LOG_OUTCOME_LABELS,
  type RegistrationLogOutcome,
  type RegistrationLogView,
} from '@/lib/registryPipeline/registrationLog';
import { getSlideStateShade } from '@/lib/slideLayout';

const ALLOW: MfaGateResult[] = ['ok'];
const PAGE_SIZE = 50;

const VIEW_OPTIONS: { value: RegistrationLogView; label: string }[] = [
  { value: 'registrations', label: 'Registration form submissions' },
  { value: 'responders', label: 'Way of Life responder form' },
  { value: 'skipped', label: 'Skipped submissions' },
  { value: 'all', label: 'Everything received' },
];

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDateOnly(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-AU', { dateStyle: 'medium' });
}

function personLabel(entry: RegistrationLogEntry): string {
  const name = [entry.firstName, entry.lastName].filter(Boolean).join(' ').trim();
  if (name && entry.email) return `${name} (${entry.email})`;
  return name || entry.email || 'Unknown contact';
}

function outcomeColor(outcome: RegistrationLogOutcome): string {
  switch (outcome) {
    case 'new_registrant': return '#15803d';
    case 'returning_registrant': return '#1d4ed8';
    case 'responder': return '#7c3aed';
    case 'error': return '#b91c1c';
    default: return '#b45309';
  }
}

const th: CSSProperties = { border: '1px solid #ccc', padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600, background: '#f3f4f6' };
const td: CSSProperties = { padding: '0.5rem', borderBottom: '1px solid #eee', verticalAlign: 'top' };

export default function RegistryManageRegistrationLogPage() {
  const gate = useRegistryGate(ALLOW);
  const [entries, setEntries] = useState<RegistrationLogEntry[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<RegistrationLogView>('registrations');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const isAdmin = gate.status === 'ready' && isNationalRegistryAdmin(gate.leaderRole?.role);

  const load = useCallback(async (targetPage: number, targetView: RegistrationLogView, targetSearch: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const { data: { session } } = await registrySupabase.auth.getSession();
      if (!session) {
        setError('Session expired — please sign in again.');
        return;
      }
      const qs = new URLSearchParams({ page: String(targetPage), view: targetView });
      if (targetSearch) qs.set('q', targetSearch);
      const res = await fetch(`/api/registry/manage-registration-log?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Failed to load the registration log.');
        return;
      }
      const body = json as RegistrationLogResponse;
      setEntries(body.entries);
      setTotalCount(body.totalCount);
      setPage(targetPage);
    } catch (err) {
      console.error('[registry/manage/registration-log] load failed:', err);
      setError('Failed to load the registration log — check the browser console for detail, or try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load(1, 'registrations', '');
  }, [isAdmin, load]);

  if (gate.status === 'loading') return null;

  // Same defense-in-depth as /registry/manage itself — middleware only
  // enforces the MFA-gate cookies, not role.
  if (!isAdmin) {
    return (
      <div style={{ maxWidth: 700, margin: '2rem auto', padding: '0 1rem' }}>
        <h1>Registration Log</h1>
        <p>This screen is only available to national registry admins.</p>
        <Link href="/registry">← Back to Registry</Link>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const changeView = (next: RegistrationLogView) => {
    setView(next);
    load(1, next, search);
  };

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    const term = searchInput.trim();
    setSearch(term);
    load(1, view, term);
  };

  return (
    <div style={{ maxWidth: 1200, margin: '2rem auto', padding: '0 1rem' }}>
      <p><Link href="/registry/manage">← Back to Registrations Management</Link></p>
      <h1>Registration Log</h1>
      <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>
        Every form submission received from ActiveCampaign, newest first, and what became of it. Use it to answer
        &ldquo;did this person&apos;s registration arrive?&rdquo; — a returning person updates their existing record
        (no new row, so the count doesn&apos;t go up), and the Way of Life responder form is kept separately from
        registrants. Times are shown in your local time; the sync runs every 4 hours.
      </p>

      <form onSubmit={submitSearch} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', margin: '1rem 0' }}>
        <label>
          Show{' '}
          <select value={view} onChange={(e) => changeView(e.target.value as RegistrationLogView)} aria-label="Which submissions to show">
            {VIEW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label>
          Find{' '}
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="name or email"
            aria-label="Search by name or email"
          />
        </label>
        <button type="submit" disabled={isLoading}>Search</button>
        {search && (
          <button type="button" onClick={() => { setSearchInput(''); setSearch(''); load(1, view, ''); }}>Clear</button>
        )}
      </form>

      {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}
      {isLoading && !entries && <p>Loading…</p>}

      {entries && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '1rem 0' }}>
            <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>
              {totalCount === 0 ? 'No matching submissions.' : `${totalCount.toLocaleString('en-AU')} submission${totalCount === 1 ? '' : 's'}`}
            </span>
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button type="button" onClick={() => load(page - 1, view, search)} disabled={page <= 1 || isLoading}>← Prev</button>
                <span>{page} / {totalPages}</span>
                <button type="button" onClick={() => load(page + 1, view, search)} disabled={page >= totalPages || isLoading}>Next →</button>
              </div>
            )}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={th}>Received</th>
                  <th style={th}>Person</th>
                  <th style={th}>First in ActiveCampaign</th>
                  <th style={th}>What happened</th>
                  <th style={th}>State</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} style={{ background: getSlideStateShade(entry.registrant?.state ?? null) }}>
                    <td style={td}>{formatDateTime(entry.receivedAt)}</td>
                    <td style={td}>{personLabel(entry)}</td>
                    <td style={td}>{formatDateOnly(entry.contactCreatedAt)}</td>
                    <td style={td}>
                      <div style={{ color: outcomeColor(entry.outcome), fontWeight: 600 }}>{REGISTRATION_LOG_OUTCOME_LABELS[entry.outcome]}</div>
                      <div style={{ color: '#6b7280', fontSize: '0.8rem' }}>{REGISTRATION_LOG_OUTCOME_EXPLANATIONS[entry.outcome]}</div>
                    </td>
                    <td style={td}>{entry.registrant?.state ?? '—'}</td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: '1rem', textAlign: 'center' }}>No matching submissions.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
