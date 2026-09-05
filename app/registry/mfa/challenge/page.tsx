'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { registrySupabase } from '@/lib/registrySupabaseClient';
import { setRegistrySessionCookie } from '@/lib/registryAuth';
import { useRegistryGate } from '@/app/registry/useRegistryGate';
import type { MfaGateResult } from '@/lib/registryPipeline/mfaGate';

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
    <div style={{ maxWidth: 400, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Enter your authenticator code</h1>
      {lookupError && <p role="alert" style={{ color: 'crimson' }}>{lookupError}</p>}
      <form onSubmit={handleVerify}>
        <label htmlFor="mfa-code">6-digit code</label>
        <input
          id="mfa-code"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          style={{ display: 'block', width: '100%', marginBottom: '1rem' }}
        />
        {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}
        <button type="submit" disabled={isVerifying || !factorId || code.length < 6}>
          {isVerifying ? 'Verifying…' : 'Verify'}
        </button>
      </form>
    </div>
  );
}
