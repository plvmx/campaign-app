'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { registrySupabase } from '@/lib/registrySupabaseClient';
import { signOutOfRegistry } from '@/lib/registryAuth';
import { useRegistryGate } from '@/app/registry/useRegistryGate';
import type { MfaGateResult } from '@/lib/registryPipeline/mfaGate';

const ALLOW: MfaGateResult[] = ['ok'];

/**
 * Landing page — proves the magic-link + MFA pipeline works end to end,
 * and links to whatever registry data screens exist so far. The full
 * registrations reload + reconciliation isn't built yet (paused pending
 * decisions on Lorraine's spreadsheet — see
 * docs/registry-pipeline/OPERATIONS.md's "Status" section); "Recent
 * Registrations" is a temporary stand-in for that in the meantime.
 */
export default function RegistryHomePage() {
  const router = useRouter();
  const gate = useRegistryGate(ALLOW);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (gate.status !== 'ready') return;
    registrySupabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, [gate.status]);

  async function handleSignOut() {
    await signOutOfRegistry();
    router.replace('/registry/login');
  }

  if (gate.status === 'loading') return null;

  return (
    <div style={{ maxWidth: 400, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>AFJ Registry</h1>
      <p>Signed in as {email ?? '…'}.</p>
      <p>Role: {gate.leaderRole?.role ?? 'unknown'}.</p>
      <p>
        <Link href="/registry/recent-registrations">Recent Registrations</Link>
      </p>
      <button type="button" onClick={handleSignOut}>Sign out</button>
    </div>
  );
}
