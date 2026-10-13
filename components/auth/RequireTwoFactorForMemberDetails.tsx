'use client';

import { useEffect, useState, type ReactNode } from 'react';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { supabase } from '@/lib/supabaseClient';
import { getErrorMessage } from '@/lib/errorUtils';
import { startTwoFactorSignIn } from '@/lib/twoFactorSetup';
import { GetHelp } from '@/components/auth/GetHelp';
import { primaryButtonClass, bodyTextClass, errorBannerClass } from '@/components/auth/CodeEntryScreen';

/**
 * Wraps any screen that shows other people's personal details (names, mobile
 * numbers, emails of members who registered interest). The database already
 * refuses those rows to a session that hasn't passed 2FA (RLS requires
 * aal2 — scripts/require_mfa_for_member_details.sql); this explains why and
 * offers the way in, rather than showing an empty list that looks like "nobody
 * registered". Children are only mounted once the session is at aal2, so they
 * never fetch the rows (and show a misleading error) before then.
 */
export default function RequireTwoFactorForMemberDetails({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'checking' | 'ok' | 'needs-2fa'>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.mfa
      .getAuthenticatorAssuranceLevel()
      .then(({ data }) => {
        if (!cancelled) setStatus(data?.currentLevel === 'aal2' ? 'ok' : 'needs-2fa');
      })
      .catch(() => {
        // Can't tell — fail closed; the database would refuse the rows anyway.
        if (!cancelled) setStatus('needs-2fa');
      });
    return () => { cancelled = true; };
  }, []);

  async function handleContinue() {
    setBusy(true);
    setError(null);
    try {
      await startTwoFactorSignIn();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Something went wrong. Please try again.'));
      setBusy(false);
    }
  }

  if (status === 'ok') return <>{children}</>;

  if (status === 'checking') {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center"><LoadingSpinner /></div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="mx-auto max-w-md space-y-4 p-4">
        <h1 className="text-center text-xl font-bold text-gray-900 dark:text-gray-100">Extra security needed</h1>
        <p className={bodyTextClass}>
          To protect the personal details of people who register interest, you need two-factor authentication (a code from an
          authenticator app on your phone) before you can see them. It takes about two minutes to set up.
        </p>
        <p className={bodyTextClass}>You will be signed out and asked to sign in again with your email.</p>
        {error && <div role="alert" className={errorBannerClass}>{error}</div>}
        <button onClick={handleContinue} disabled={busy} className={`${primaryButtonClass} disabled:opacity-50`}>
          {busy ? 'Please wait…' : 'Set up two-factor authentication'}
        </button>
        <GetHelp />
      </div>
    </MobileLayout>
  );
}
