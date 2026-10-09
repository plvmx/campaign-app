'use client';

import { useState } from 'react';
import { getErrorMessage } from '@/lib/errorUtils';
import { normalizeOtpInput, EMAIL_OTP_MIN_LENGTH, EMAIL_OTP_MAX_LENGTH } from '@/lib/otpInput';
import { inputClass, labelClass, primaryButtonClass, errorBannerClass, bodyTextClass } from '@/components/auth/CodeEntryScreen';

/**
 * Recovery form for a magic link that already failed — the "expired/
 * invalid link" screens on /confirm-email, /setup-mfa, and
 * /login/mfa/callback (added 2026-10-05, same incident as
 * components/auth/InlineCodeFallback.tsx). That sibling component lives on
 * the *sending* screen ("check your inbox") and already knows the leader's
 * email, so it only asks for the code. This one lives on the *failure*
 * screen instead — the page a leader actually sees and can act on, since by
 * the time a link fails (Apple Mail Privacy Protection silently consuming
 * it before they ever tap it) they've long since left the sending screen —
 * and that page never collected an email (it only ever had the link to go
 * on), so it has to ask for both.
 *
 * Shown directly, not collapsed behind a toggle, unlike InlineCodeFallback —
 * this already *is* the recovery screen, so there's no "common case" to
 * keep uncluttered.
 *
 * onVerify only needs to call verifyOtp() and throw on failure — on
 * success, the host page's own onAuthStateChange listener (still subscribed
 * from initial mount; the failed first attempt never actually ran its
 * handler, so nothing blocks it from firing again) picks up the resulting
 * SIGNED_IN event and runs the exact same flow a working link would have.
 * No separate success handling needed here.
 */
export function EmailAndCodeFallback({ onVerify }: { onVerify: (email: string, code: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function handleVerify() {
    setIsBusy(true);
    setError(null);
    try {
      await onVerify(email, code);
    } catch (err) {
      setError(getErrorMessage(err, 'Invalid or expired code'));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="space-y-3 border-t-2 border-gray-200 pt-4 dark:border-gray-700">
      <p className={bodyTextClass}>Or enter your email and the code from that email to try again:</p>
      <div>
        <label htmlFor="recovery-email" className={labelClass}>Email address</label>
        <input
          id="recovery-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="recovery-code" className={labelClass}>Code from the email</label>
        <input
          id="recovery-code"
          inputMode="numeric"
          pattern="[0-9]*"
          value={code}
          onChange={(e) => setCode(normalizeOtpInput(e.target.value, EMAIL_OTP_MAX_LENGTH))}
          className={inputClass}
        />
      </div>
      {error && <p role="alert" className={errorBannerClass}>{error}</p>}
      <button onClick={handleVerify} disabled={isBusy || !email || code.length < EMAIL_OTP_MIN_LENGTH} className={primaryButtonClass}>
        {isBusy ? 'Verifying…' : 'Verify code'}
      </button>
    </div>
  );
}
