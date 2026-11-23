'use client';

/**
 * Member area home — for now just proof of a working sign-in: a welcome and
 * Sign out. What members can do here (update details, find campaigns) is built
 * on `authorizeMemberRequest` in later steps (docs/member-portal/SIGN_IN_DESIGN.md).
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { bodyTextClass, cardClass, headingClass, primaryButtonClass, secondaryButtonClass } from '@/components/auth/CodeEntryScreen';
import { fetchMemberMe, signOutMember } from '@/lib/memberAuthClient';

const SIGN_IN = '/member/sign-in';

export default function MemberHomePage() {
  const router = useRouter();
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'ready'; firstName: string | null } | { kind: 'error'; message: string }>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMemberMe().then((me) => {
      if (cancelled) return;
      if (me.status === 'signed_out') { router.replace(SIGN_IN); return; }
      setState(me.status === 'ok' ? { kind: 'ready', firstName: me.firstName } : { kind: 'error', message: me.message });
    });
    return () => { cancelled = true; };
  }, [router]);

  const signOut = async (allDevices: boolean) => {
    setBusy(true);
    const { ok } = await signOutMember(allDevices);
    if (ok) router.replace(SIGN_IN);
    else { setBusy(false); setState({ kind: 'error', message: "We couldn't sign you out just now. Please try again." }); }
  };

  return (
    <main data-ti="app/member/page.tsx" className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-950">
      <div className={`${cardClass} space-y-6`}>
        {state.kind === 'loading' && <p className={bodyTextClass} role="status">One moment…</p>}
        {state.kind === 'error' && <p role="alert" className={bodyTextClass}>{state.message}</p>}
        {state.kind === 'ready' && (
          <>
            <h1 className={headingClass}>{state.firstName ? `Welcome, ${state.firstName}` : 'Welcome'}</h1>
            <p className={bodyTextClass}>You are signed in. Your personal area is still being built — more will appear here soon.</p>
            <button type="button" onClick={() => void signOut(false)} disabled={busy} className={primaryButtonClass}>Sign out</button>
            <button type="button" onClick={() => void signOut(true)} disabled={busy} className={secondaryButtonClass}>Sign out on all my devices</button>
          </>
        )}
      </div>
    </main>
  );
}
