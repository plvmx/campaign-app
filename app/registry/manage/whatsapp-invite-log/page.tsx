'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { registrySupabase } from '@/lib/registrySupabaseClient';
import { useRegistryGate } from '@/app/registry/useRegistryGate';
import { isNationalRegistryAdmin, type MfaGateResult } from '@/lib/registryPipeline/mfaGate';
import type { WhatsAppInviteLogEntry, WhatsAppInviteLogResponse } from '@/lib/registryPipeline/manageSummaryTypes';
import { getSlideStateShade } from '@/lib/slideLayout';

const ALLOW: MfaGateResult[] = ['ok'];
const PAGE_SIZE = 50;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

function registrantLabel(entry: WhatsAppInviteLogEntry): string {
  if (!entry.registrant) return 'Unknown registrant';
  const name = [entry.registrant.firstName, entry.registrant.lastName].filter(Boolean).join(' ').trim();
  if (name && entry.registrant.email) return `${name} (${entry.registrant.email})`;
  return name || entry.registrant.email || 'Unknown registrant';
}

function statusLabel(status: WhatsAppInviteLogEntry['status']): string {
  switch (status) {
    case 'sent': return 'Sent';
    case 'failed': return 'Failed';
    case 'skipped_no_link': return 'Skipped (no invite link configured)';
  }
}

function statusColor(status: WhatsAppInviteLogEntry['status']): string {
  switch (status) {
    case 'sent': return '#15803d';
    case 'failed': return '#b91c1c';
    case 'skipped_no_link': return '#b45309';
  }
}

/** The one detail column worth showing next to status: the error for a failure, the Resend id for a send, nothing for a skip. */
function detailText(entry: WhatsAppInviteLogEntry): string {
  if (entry.status === 'failed') return entry.error ?? '—';
  if (entry.status === 'sent') return entry.resendMessageId ?? '—';
  return '—';
}

const th: CSSProperties = { border: '1px solid #ccc', padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600, background: '#f3f4f6' };
const td: CSSProperties = { padding: '0.5rem', borderBottom: '1px solid #eee' };

export default function RegistryManageWhatsAppInviteLogPage() {
  const gate = useRegistryGate(ALLOW);
  const [entries, setEntries] = useState<WhatsAppInviteLogEntry[] | null>(null);
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
      const res = await fetch(`/api/registry/manage-whatsapp-invite-log?page=${targetPage}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Failed to load the WhatsApp invite log.');
        return;
      }
      const body = json as WhatsAppInviteLogResponse;
      setEntries(body.entries);
      setTotalCount(body.totalCount);
      setPage(targetPage);
    } catch (err) {
      console.error('[registry/manage/whatsapp-invite-log] load failed:', err);
      setError('Failed to load the WhatsApp invite log — check the browser console for detail, or try again.');
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
        <h1>WhatsApp Invite Log</h1>
        <p>This screen is only available to national registry admins.</p>
        <Link href="/registry">← Back to Registry</Link>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
      <p><Link href="/registry/manage">← Back to Registrations Management</Link></p>
      <h1>WhatsApp Invite Log</h1>
      <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>
        Every WhatsApp group invite email attempt made on a new registration, newest first — including ones skipped
        because no invite link is configured yet.
      </p>

      {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}
      {isLoading && !entries && <p>Loading…</p>}

      {entries && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '1rem 0' }}>
            <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>
              {totalCount === 0 ? 'No invite attempts recorded yet.' : `${totalCount.toLocaleString('en-AU')} attempt${totalCount === 1 ? '' : 's'} recorded`}
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
                  <th style={th}>Attempted at</th>
                  <th style={th}>Registrant</th>
                  <th style={th}>Status</th>
                  <th style={th}>Detail</th>
                  <th style={th}>Campaigns Near Me link included</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} style={{ background: getSlideStateShade(entry.registrant?.state ?? null) }}>
                    <td style={td}>{formatDateTime(entry.attemptedAt)}</td>
                    <td style={td}>{registrantLabel(entry)}</td>
                    <td style={{ ...td, color: statusColor(entry.status), fontWeight: 600 }}>{statusLabel(entry.status)}</td>
                    <td style={td}>{detailText(entry)}</td>
                    <td style={td}>{entry.includedCampaignsNearMeLink ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: '1rem', textAlign: 'center' }}>No matching records.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
