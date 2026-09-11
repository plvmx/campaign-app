'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { registrySupabase } from '@/lib/registrySupabaseClient';
import { useRegistryGate } from '@/app/registry/useRegistryGate';
import { isNationalRegistryAdmin, type MfaGateResult } from '@/lib/registryPipeline/mfaGate';
import { EDITABLE_FIELD_LABELS } from '@/lib/registryPipeline/registrantValidation';
import type { RegistrantEditLogEntry, RegistrantEditLogResponse } from '@/lib/registryPipeline/manageSummaryTypes';
import { getSlideStateShade } from '@/lib/slideLayout';

const ALLOW: MfaGateResult[] = ['ok'];
const PAGE_SIZE = 50;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

function registrantLabel(entry: RegistrantEditLogEntry): string {
  if (!entry.registrant) return 'Unknown registrant';
  const name = [entry.registrant.firstName, entry.registrant.lastName].filter(Boolean).join(' ').trim();
  if (name && entry.registrant.email) return `${name} (${entry.registrant.email})`;
  return name || entry.registrant.email || 'Unknown registrant';
}

const th: CSSProperties = { border: '1px solid #ccc', padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600, background: '#f3f4f6' };
const td: CSSProperties = { padding: '0.5rem', borderBottom: '1px solid #eee' };

export default function RegistryManageEditLogPage() {
  const gate = useRegistryGate(ALLOW);
  const [entries, setEntries] = useState<RegistrantEditLogEntry[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const isAdmin = gate.status === 'ready' && isNationalRegistryAdmin(gate.leaderRole?.role);

  const load = useCallback(async (targetPage: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const { data: { session } } = await registrySupabase.auth.getSession();
      if (!session) {
        setError('Session expired — please sign in again.');
        return;
      }
      const res = await fetch(`/api/registry/manage-edit-log?page=${targetPage}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Failed to load the edit log.');
        return;
      }
      const body = json as RegistrantEditLogResponse;
      setEntries(body.entries);
      setTotalCount(body.totalCount);
      setPage(targetPage);
    } catch (err) {
      console.error('[registry/manage/edit-log] load failed:', err);
      setError('Failed to load the edit log — check the browser console for detail, or try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load(1);
  }, [isAdmin, load]);

  if (gate.status === 'loading') return null;

  // Same defense-in-depth as /registry/manage itself — middleware only
  // enforces the MFA-gate cookies, not role, so a state_leader navigating
  // straight here would otherwise see nothing but a 401 from the API.
  if (!isAdmin) {
    return (
      <div style={{ maxWidth: 700, margin: '2rem auto', padding: '0 1rem' }}>
        <h1>Registration Edit Log</h1>
        <p>This screen is only available to national registry admins.</p>
        <Link href="/registry">← Back to Registry</Link>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
      <p><Link href="/registry/manage">← Back to Registrations Management</Link></p>
      <h1>Registration Edit Log</h1>
      <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>
        Every manual correction made from the Registrations Management console&apos;s Edit mode, newest first.
      </p>

      {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}
      {isLoading && !entries && <p>Loading…</p>}

      {entries && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '1rem 0' }}>
            <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>
              {totalCount === 0 ? 'No edits recorded yet.' : `${totalCount.toLocaleString('en-AU')} edit${totalCount === 1 ? '' : 's'} recorded`}
            </span>
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button type="button" onClick={() => load(page - 1)} disabled={page <= 1 || isLoading}>← Prev</button>
                <span>{page} / {totalPages}</span>
                <button type="button" onClick={() => load(page + 1)} disabled={page >= totalPages || isLoading}>Next →</button>
              </div>
            )}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={th}>Edited at</th>
                  <th style={th}>Registrant</th>
                  <th style={th}>Field</th>
                  <th style={th}>Old value</th>
                  <th style={th}>New value</th>
                  <th style={th}>Edited by</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} style={{ background: getSlideStateShade(entry.registrant?.state ?? null) }}>
                    <td style={td}>{formatDateTime(entry.editedAt)}</td>
                    <td style={td}>{registrantLabel(entry)}</td>
                    <td style={td}>{EDITABLE_FIELD_LABELS[entry.field] ?? entry.field}</td>
                    <td style={td}>{entry.oldValue ?? '—'}</td>
                    <td style={td}>{entry.newValue ?? '—'}</td>
                    <td style={td}>{entry.editedByEmail ?? '—'}</td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: '1rem', textAlign: 'center' }}>No matching records.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
