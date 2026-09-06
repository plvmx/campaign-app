'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { registrySupabase } from '@/lib/registrySupabaseClient';
import { setRegistrySessionCookie } from '@/lib/registryAuth';
import { useRegistryGate } from '@/app/registry/useRegistryGate';
import type { MfaGateResult } from '@/lib/registryPipeline/mfaGate';
import {
  RegistryAuthLayout,
  registryInputClass,
  registryLabelClass,
  registryPrimaryButtonClass,
  registryErrorBannerClass,
} from '@/components/registry/RegistryAuthLayout';

const ALLOW: MfaGateResult[] = ['needs_challenge'];

export default function RegistryMfaChallengePage() {
  const router = useRouter();
  const gate = useRegistryGate(ALLOW);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  useEffect(() => {
    if (gate.status !== 'ready' || factorId) return;
    registrySupabase.auth.mfa.listFactors().then(({ data, error: listError }) => {
      if (listError) {
        setLookupError(listError.message);
        return;
      }
      const verified = data.totp.find((f) => f.status === 'verified');
      if (!verified) {
        setLookupError('No verified authenticator app found on this account.');
        return;
      }
      setFactorId(verified.id);
    });
  }, [gate.status, factorId]);

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setIsVerifying(true);
    setError(null);
    const { error: verifyError } = await registrySupabase.auth.mfa.challengeAndVerify({ factorId, code });
    setIsVerifying(false);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }
    setRegistrySessionCookie();
    router.replace('/registry');
  }

  if (gate.status === 'loading') return null;

  return (
    <RegistryAuthLayout title="Enter your authenticator code">
      {lookupError && <p role="alert" className={registryErrorBannerClass}>{lookupError}</p>}
      <form onSubmit={handleVerify} className="space-y-4">
        <div>
          <label htmlFor="mfa-code" className={registryLabelClass}>6-digit code</label>
          <input
            id="mfa-code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={registryInputClass}
          />
        </div>
        {error && <p role="alert" className={registryErrorBannerClass}>{error}</p>}
        <button type="submit" disabled={isVerifying || !factorId || code.length < 6} className={registryPrimaryButtonClass}>
          {isVerifying ? 'Verifying…' : 'Verify'}
        </button>
      </form>
    </RegistryAuthLayout>
  );
}
