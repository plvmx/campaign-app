'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { getErrorMessage } from '@/lib/errorUtils';
import { fetchStuckLeaders } from '@/lib/services/stuckLeadersClient';
import type { StuckLeader } from '@/lib/services/stuckLeadersService';
import { toSupportNumber } from '@/lib/supportContact';

function timeAgo(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'no activity recorded';
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function nudgeMessage(leader: StuckLeader): string {
  const firstName = leader.name.replace(/_(AD|SR)$/i, '');
  return `Hi ${firstName}, I can see you started setting up your secure AFJ sign-in but haven't finished. Can I help? Step-by-step guide: ${window.location.origin}/help/2fa`;
}

export default function StuckLeadersPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();
  const [leaders, setLeaders] = useState<StuckLeader[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    if (!isAdmin) {
      Promise.resolve().then(() => setError('You do not have permission to access this page'));
      return;
    }
    let cancelled = false;
    fetchStuckLeaders()
      .then((result) => {
        if (cancelled) return;
        setError(null);
        setLeaders(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Failed to load the list'));
      });
    return () => { cancelled = true; };
  }, [isUserLoading, user, isAdmin, router, reloadKey]);

  if (isUserLoading || (leaders === null && !error)) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center"><LoadingSpinner /></div>
      </MobileLayout>
    );
  }

  const admins = (leaders ?? []).filter((l) => l.isAdmin);
  const others = (leaders ?? []).filter((l) => !l.isAdmin);

  const renderCard = (l: StuckLeader) => {
    const number = toSupportNumber(l.mobile);
    return (
      <li key={l.key} className="rounded-lg border-2 border-gray-800 bg-white p-4 shadow-sm dark:border-gray-600 dark:bg-gray-800">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">{l.name}</span>
          <span className="rounded-full bg-gray-200 px-3 py-0.5 text-sm font-semibold text-gray-800 dark:bg-gray-700 dark:text-gray-200">
            {l.role} · {l.states.join(', ')}
          </span>
        </div>
        <p className="mt-1 font-semibold text-red-700 dark:text-red-300">{l.label}</p>
        <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{l.action}</p>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Last activity: {timeAgo(l.lastActivityAt)}{l.email ? ` · ${l.email}` : ''}{l.mobile ? ` · ${l.mobile}` : ''}
        </p>
        {number && (
          <div className="mt-3 flex gap-2">
            <a href={`tel:${number}`} className="rounded-md border-2 border-gray-800 bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 dark:border-gray-600">Call</a>
            <a
              href={`sms:${number}?&body=${encodeURIComponent(nudgeMessage(l))}`}
              className="rounded-md border-2 border-gray-800 bg-white px-4 py-2 text-sm font-bold text-gray-900 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            >
              Text a reminder
            </a>
          </div>
        )}
      </li>
    );
  };

  return (
    <MobileLayout>
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Leaders who are stuck</h1>
          <button onClick={() => { setLeaders(null); setReloadKey((k) => k + 1); }} className="rounded-md border-2 border-gray-800 bg-white px-3 py-1 text-sm font-bold text-gray-900 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100">
            Refresh
          </button>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          People who haven&apos;t finished setting up email sign-in and two-factor authentication, and the step they&apos;re at. Admins
          (and state reporters) are listed until they finish, because they can&apos;t sign in as an admin without it. Other leaders only
          appear if they started and didn&apos;t finish.
        </p>

        {error && <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-200">{error}</div>}

        {leaders && leaders.length === 0 && (
          <p className="rounded-md bg-green-50 p-4 text-green-900 dark:bg-green-900/20 dark:text-green-200">Nobody is stuck right now.</p>
        )}

        {admins.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Admins who can&apos;t sign in as admin yet ({admins.length})</h2>
            <ul className="space-y-3">{admins.map(renderCard)}</ul>
          </section>
        )}

        {others.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Other leaders part-way through ({others.length})</h2>
            <ul className="space-y-3">{others.map(renderCard)}</ul>
          </section>
        )}
      </div>
    </MobileLayout>
  );
}
