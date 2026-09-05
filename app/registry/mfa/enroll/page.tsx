'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { registrySupabase } from '@/lib/registrySupabaseClient';
import { setRegistrySessionCookie } from '@/lib/registryAuth';
import { useRegistryGate } from '@/app/registry/useRegistryGate';
import type { MfaGateResult } from '@/lib/registryPipeline/mfaGate';

const ALLOW: MfaGateResult[] = ['needs_enrollment'];

export default function RegistryMfaEnrollPage() {
  const router = useRouter();
  const gate = useRegistryGate(ALLOW);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    if (gate.status !== 'ready' || factorId) return;
    registrySupabase.auth.mfa.enroll({ factorType: 'totp' }).then(({ data, error: enrollError }) => {
      if (enrollError) {
        setError(enrollError.message);
        return;
      }
      setFactorId(data.id);
      // qr_code is the raw SVG markup, not a ready-to-use data URI — per
      // supabase-js's own doc comment, the caller prepends the data:
      // prefix. Confirmed live: naively concatenating it (no encoding)
      // renders a blank image, because QR SVGs contain hex-color fills
      // like fill="#000000" — the unencoded '#' is read as the URI's
      // fragment delimiter, truncating everything after it. encodeURIComponent
      // escapes '#' (and anything else that would confuse URI parsing).
      setQrCode(`data:image/svg+xml,${encodeURIComponent(data.totp.qr_code)}`);
      setSecret(data.totp.secret);
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
      <h1>Set up two-factor authentication</h1>
      <p>Your role requires an authenticator app (e.g. Google Authenticator, 1Password, Authy). Scan the code below, then enter the 6-digit code it shows.</p>
      {qrCode && (
        // eslint-disable-next-line @next/next/no-img-element -- Supabase returns this as a data: URI SVG, not a static asset next/image can optimize.
        <img src={qrCode} alt="Scan this QR code with your authenticator app" width={200} height={200} />
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
