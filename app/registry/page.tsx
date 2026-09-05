'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { registrySupabase } from '@/lib/registrySupabaseClient';
import { signOutOfRegistry } from '@/lib/registryAuth';
import { useRegistryGate } from '@/app/registry/useRegistryGate';
import type { MfaGateResult } from '@/lib/registryPipeline/mfaGate';

const ALLOW: MfaGateResult[] = ['ok'];

/**
 * Placeholder landing page — proves the magic-link + MFA pipeline works
 * end to end. The actual registry data screens (duplicate review, etc.)
 * are still blocked pending Lorraine's spreadsheet reload; see
 * docs/registry-pipeline/OPERATIONS.md's "Status" section.
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
      <p>Registry data screens aren&apos;t built yet — this confirms sign-in and MFA are working.</p>
      <button type="button" onClick={handleSignOut}>Sign out</button>
    </div>
  );
}
