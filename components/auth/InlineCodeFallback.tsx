'use client';

import { useState } from 'react';
import { getErrorMessage } from '@/lib/errorUtils';
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass, errorBannerClass } from '@/components/auth/CodeEntryScreen';

/**
 * Collapsed-by-default "type the code instead" option for a magic-link
 * "check your inbox" screen — added 2026-10-05 after tracing a cluster of
 * leaders who authenticate successfully at the Supabase level (confirmed via
 * auth.users.last_sign_in_at updating on every attempt) but never complete
 * the app-side step, traced to Apple Mail Privacy Protection silently
 * pre-fetching — and thereby consuming — the one-time link before the
 * leader ever taps it. A typed code can't be consumed that way: nothing
 * reads an email body and types into a form except the person it was sent
 * to. Supabase already generates this code for every magic-link send; it
 * just isn't shown in the email unless the "Magic Link" template includes
 * {{ .Token }} (a one-time Supabase Dashboard change, not code).
 *
 * Deliberately collapsed by default rather than shown alongside the link
 * every time — most leaders' links work fine, and a second, equally
 * prominent "enter a code" box right next to the "check your inbox" message
 * would just be confusing clutter for the common case.
 *
 * Owns only its own UI state (expanded/busy/error) — the caller supplies the
 * actual verifyOtp() + handoff logic via onVerify, since that differs per
 * flow (which Supabase client, what happens after a successful code).
 */
export function InlineCodeFallback({ onVerify }: { onVerify: (code: string) => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  if (!expanded) {
    return (
      <button type="button" onClick={() => setExpanded(true)} className={secondaryButtonClass}>
        Link not working? Enter the code from the email instead
      </button>
    );
  }

  async function handleVerify() {
    setIsBusy(true);
    setError(null);
    try {
      await onVerify(code);
    } catch (err) {
      setError(getErrorMessage(err, 'Invalid or expired code'));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div>
        <label htmlFor="inline-code-fallback" className={labelClass}>6-digit code from the email</label>
        <input
          id="inline-code-fallback"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={inputClass}
        />
      </div>
      {error && <p role="alert" className={errorBannerClass}>{error}</p>}
      <button onClick={handleVerify} disabled={isBusy || code.length < 6} className={primaryButtonClass}>
        {isBusy ? 'Verifying…' : 'Verify code'}
      </button>
    </div>
  );
}
