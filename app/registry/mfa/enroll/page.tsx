'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'react-qr-code';
import { registrySupabase } from '@/lib/registrySupabaseClient';
import { setRegistrySessionCookie } from '@/lib/registryAuth';
import { useRegistryGate } from '@/app/registry/useRegistryGate';
import type { MfaGateResult } from '@/lib/registryPipeline/mfaGate';

const ALLOW: MfaGateResult[] = ['needs_enrollment'];

export default function RegistryMfaEnrollPage() {
  const router = useRouter();
  const gate = useRegistryGate(ALLOW);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    if (gate.status !== 'ready' || factorId) return;

    let cancelled = false;

    (async () => {
      // Clean up any stale unverified TOTP factor from an earlier attempt
      // first. Confirmed live: Supabase rejects a second enroll() call
      // with a 422 "factor name conflict" once one unverified factor
      // already exists (both default to the same empty friendly_name) —
      // without this, anyone who reloads this page, or whose first
      // attempt didn't complete for any reason, would be permanently
      // stuck unable to ever enroll.
      const { data: factorsData, error: listError } = await registrySupabase.auth.mfa.listFactors();
      if (cancelled) return;
      if (listError) {
        setError(listError.message);
        return;
      }
      const staleFactors = factorsData.all.filter((f) => f.factor_type === 'totp' && f.status !== 'verified');
      for (const f of staleFactors) {
        await registrySupabase.auth.mfa.unenroll({ factorId: f.id });
      }
      if (cancelled) return;

      const { data, error: enrollError } = await registrySupabase.auth.mfa.enroll({ factorType: 'totp' });
      if (cancelled) return;
      if (enrollError) {
        setError(enrollError.message);
        return;
      }
      setFactorId(data.id);
      // Deliberately NOT using data.totp.qr_code (Supabase's own rendered
      // SVG) — confirmed live it's absurdly bloated (362,632 characters
      // for a 231x231px code, a known upstream inefficiency in how
      // GoTrue's QR library draws it) and effectively unusable as an
      // <img> data: URI. data.totp.uri is the actual small
      // otpauth://totp/... string the QR code encodes — rendering our
      // own compact QR from it client-side (react-qr-code, pure SVG, no
      // data: URI at all) sidesteps the bloat entirely.
      setTotpUri(data.totp.uri);
      setSecret(data.totp.secret);
    })();

    return () => {
      cancelled = true;
    };
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
      <h1>Set up two-factor authentication</h1>
      <p>Your role requires an authenticator app (e.g. Google Authenticator, 1Password, Authy). Scan the code below, then enter the 6-digit code it shows.</p>
      {totpUri && (
        <div style={{ padding: '1rem', background: '#fff', width: 'fit-content' }}>
          <QRCode value={totpUri} size={200} />
        </div>
      )}
      {secret && (
        <p>
          Can&apos;t scan it? Enter this key manually: <code>{secret}</code>
        </p>
      )}
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
          {isVerifying ? 'Verifying…' : 'Verify and continue'}
        </button>
      </form>
    </div>
  );
}
