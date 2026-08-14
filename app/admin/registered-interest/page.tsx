'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import {
  getCampaignInterestList,
  setCampaignInterestContacted,
  type CampaignInterestWithCampaign,
} from '@/lib/services/campaignInterestService';
import { getSlideStateColor } from '@/lib/slideLayout';
import { formatCampaignTimeDisplay } from '@/lib/campaignUtils';
import { combinePlaceAndSite } from '@/lib/placeSite';
import { getErrorMessage } from '@/lib/errorUtils';

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString('en-AU', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

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
      await setCampaignInterestContacted(id, nextContacted);
      const contactedAt = nextContacted ? new Date().toISOString() : null;
      setEntries(prev => prev.map(e => (e.id === id ? { ...e, contacted: nextContacted, contacted_at: contactedAt } : e)));
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
          <h1 className="pr-14 text-2xl font-bold text-gray-900 dark:text-gray-100">Registered Interest</h1>
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
          <div className="p-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Registrations ({entries.length})
            </h2>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {isLoading ? (
              <div className="p-8 flex justify-center">
                <LoadingSpinner text="Loading registered interest…" />
              </div>
            ) : entries.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                No one has registered interest yet.
              </div>
            ) : (
              entries.map(entry => {
                const campaign = entry.campaign;
                const isUpdating = updatingIds.has(entry.id);
                return (
                  <div key={entry.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {campaign ? (
                          <div className="font-bold" style={{ color: getSlideStateColor(campaign.state) }}>
                            {combinePlaceAndSite(campaign.place, campaign.site)} — {campaign.state}
                          </div>
                        ) : (
                          <div className="font-bold text-gray-400 italic">Campaign no longer exists</div>
                        )}
                        {campaign && (
                          <div className="text-sm text-gray-600 dark:text-gray-400">
                            {new Date(campaign.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                            {' at '}{formatCampaignTimeDisplay(campaign.time)} — Leader: {campaign.leader}
                          </div>
                        )}
                        <div className="mt-2 text-base text-gray-900 dark:text-gray-100">
                          {entry.first_name} — {entry.mobile}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                          <span
                            className={`rounded-md px-2 py-0.5 font-bold text-white ${
                              entry.interest_type === 'in' ? 'bg-green-600' : 'bg-orange-500'
                            }`}
                          >
                            {entry.interest_type === 'in' ? "Yes I'm In" : 'Tell Me More'}
                          </span>
                          <span className="text-gray-500 dark:text-gray-400">
                            Registered {formatDateTime(entry.created_at)}
                          </span>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <label className="flex items-center justify-end gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                          <span>Contacted</span>
                          <input
                            type="checkbox"
                            checked={entry.contacted}
                            disabled={isUpdating}
                            onChange={e => handleToggleContacted(entry.id, e.target.checked)}
                            className="h-5 w-5 accent-blue-600 disabled:opacity-50"
                          />
                        </label>
                        {entry.contacted && entry.contacted_at && (
                          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            {formatDateTime(entry.contacted_at)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </MobileLayout>
  );
}
