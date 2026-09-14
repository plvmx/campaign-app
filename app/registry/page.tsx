'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { registrySupabase } from '@/lib/registrySupabaseClient';
import { signOutOfRegistry } from '@/lib/registryAuth';
import { useRegistryGate } from '@/app/registry/useRegistryGate';
import { isNationalRegistryAdmin, type MfaGateResult } from '@/lib/registryPipeline/mfaGate';
import {
  RegistryAuthLayout,
  registryPrimaryButtonClass,
  registrySecondaryButtonClass,
  registryBodyTextClass,
} from '@/components/registry/RegistryAuthLayout';

const ALLOW: MfaGateResult[] = ['ok'];

/**
 * Landing page — proves the magic-link + MFA pipeline works end to end,
 * and links to whatever registry data screens exist so far. The
 * registrations reload is done and `registry.registrants` is kept
 * current by ac-sync, so this only ever links to `/registry/manage`
 * (national_admin/whatsapp_admin only) — see
 * docs/registry-pipeline/OPERATIONS.md's 2026-09-14 entry for why the
 * earlier "Recent Registrations" live-AC-lookup screen was retired
 * rather than kept as a spot-check tool.
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
    <RegistryAuthLayout title="AFJ Registry">
      <p className={registryBodyTextClass}>
        Signed in as {email ?? '…'}.<br />
        Role: {gate.leaderRole?.role ?? 'unknown'}.
      </p>
      <div className="space-y-3">
        {isNationalRegistryAdmin(gate.leaderRole?.role) && (
          <Link href="/registry/manage" className={`${registryPrimaryButtonClass} block text-center`}>
            Manage
          </Link>
        )}
        <button type="button" onClick={handleSignOut} className={registrySecondaryButtonClass}>Sign out</button>
      </div>
    </RegistryAuthLayout>
  );
}
