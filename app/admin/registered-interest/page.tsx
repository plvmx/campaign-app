'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import CampaignInterestEntryList from '@/components/CampaignInterestEntryList';
import { useUser } from '@/contexts/UserContext';
import {
  getCampaignInterestList,
  setCampaignInterestContacted,
  type CampaignInterestWithCampaign,
} from '@/lib/services/campaignInterestService';
import { getErrorMessage } from '@/lib/errorUtils';

export default function RegisteredInterestPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();
  const [hasAccess, setHasAccess] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  const [entries, setEntries] = useState<CampaignInterestWithCampaign[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Ids currently being toggled — disables that row's checkbox until the update lands.
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    // setState is deferred through a resolved Promise to avoid synchronous setState
    // inside the effect body, matching the pattern used elsewhere in the app.
    Promise.resolve().then(() => {
      if (!isAdmin) {
        setAccessError('You do not have permission to access this page');
        return;
      }
      setHasAccess(true);
    });
  }, [isUserLoading, user, isAdmin, router]);

  useEffect(() => {
    if (!hasAccess) return;
    let cancelled = false;

    Promise.resolve()
      .then(() => {
        setIsLoading(true);
        setLoadError(null);
        return getCampaignInterestList();
      })
      .then(result => {
        if (!cancelled) setEntries(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(getErrorMessage(err, 'Failed to load registered interest'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [hasAccess]);

  const handleToggleContacted = async (id: string, nextContacted: boolean) => {
    setUpdateError(null);
    setUpdatingIds(prev => new Set(prev).add(id));
    try {
      const { contacted_at } = await setCampaignInterestContacted(id, nextContacted);
      setEntries(prev => prev.map(e => (e.id === id ? { ...e, contacted: nextContacted, contacted_at } : e)));
    } catch (err: unknown) {
      setUpdateError(getErrorMessage(err, 'Failed to update contacted status'));
    } finally {
      setUpdatingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  if (isUserLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <LoadingSpinner />
        </div>
      </MobileLayout>
    );
  }

  if (!hasAccess) {
    return (
      <MobileLayout>
        <div className="p-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-200">Access Denied</h2>
            <p className="mt-1 text-sm text-red-600 dark:text-red-300">
              {accessError || 'You do not have permission to access this page.'}
            </p>
            <button
              onClick={() => router.push('/app')}
              className="mt-4 rounded-md bg-red-600 px-4 py-2 text-base font-bold text-white hover:bg-red-700 border-2 border-gray-800 dark:border-gray-600"
            >
              Go Back
            </button>
          </div>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="p-4">
        <div className="relative mb-3">
          <button
            onClick={() => router.push('/admin')}
            className="absolute right-0 top-0 rounded bg-gray-200 px-1.5 py-0.5 text-xs font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border border-gray-800 dark:border-gray-600"
          >
            Back
          </button>
          <h1 className="pr-14 text-2xl font-bold text-gray-900 dark:text-gray-100">Campaign Interest ({entries.length})</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Members who have registered interest in joining a campaign via the Register Interest screen. Tick Contacted once you&apos;ve followed up with them.
          </p>
        </div>

        {loadError && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
            {loadError}
          </div>
        )}
        {updateError && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
            {updateError}
          </div>
        )}

        <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white shadow-sm dark:bg-gray-800">
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {isLoading ? (
              <div className="p-8 flex justify-center">
                <LoadingSpinner text="Loading registered interest…" />
              </div>
            ) : (
              <CampaignInterestEntryList entries={entries} updatingIds={updatingIds} onToggleContacted={handleToggleContacted} />
            )}
          </div>
        </div>
      </div>
    </MobileLayout>
  );
}
