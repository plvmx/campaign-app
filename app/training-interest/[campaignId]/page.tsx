'use client';

/**
 * Full list of people who registered interest in one training campaign
 * (category BOTJ/TLT) via its public link. Access control relies on
 * getCampaignById's RLS-gated query: it returns null both when the campaign
 * doesn't exist and when the signed-in user isn't its owning/shared leader
 * or an admin (see supabase/rls-policies.sql's campaigns SELECT policy) — so
 * this page can't distinguish "not found" from "not yours", which is the
 * safer failure mode for PII.
 */
import { useEffect, useState, use as usePromise } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { getCampaignById } from '@/lib/services/campaignService';
import {
  getTrainingInterestForCampaign,
  setTrainingInterestContacted,
  isTrainingCategory,
  type TrainingInterest,
} from '@/lib/services/trainingInterestService';
import { formatCampaignTimeDisplay } from '@/lib/campaignUtils';
import { combinePlaceAndSite } from '@/lib/placeSite';
import { getErrorMessage } from '@/lib/errorUtils';
import type { Campaign } from '@/lib/types';

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString('en-AU', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export default function TrainingInterestDetailPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = usePromise(params);
  const router = useRouter();
  const { user, isLoading: isUserLoading } = useUser();

  // isLoading starts true (rather than a third "not yet loaded" state on
  // `campaign`) so the very first render — before the effect below has run —
  // shows the loading spinner rather than flashing the "not found" screen.
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [entries, setEntries] = useState<TrainingInterest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }

    let cancelled = false;
    Promise.resolve()
      .then(() => {
        setIsLoading(true);
        setLoadError(null);
        // Fetched in parallel — training_interest's own RLS policy (see
        // supabase/rls-policies.sql) independently re-derives "is this user
        // the owning/shared leader or admin" via its own join through
        // campaigns, so this doesn't need to wait on getCampaignById first
        // to be safe; it just costs one wasted query on an invalid/
        // inaccessible campaignId, which is fine on this authenticated page.
        return Promise.all([getCampaignById(campaignId), getTrainingInterestForCampaign(campaignId)]);
      })
      .then(([c, result]) => {
        if (cancelled) return;
        setCampaign(c);
        setEntries(c && isTrainingCategory(c.category) ? result : []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(getErrorMessage(err, 'Failed to load training interest'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [isUserLoading, user, campaignId, router]);

  const handleToggleContacted = async (id: string, nextContacted: boolean) => {
    setUpdateError(null);
    setUpdatingIds((prev) => new Set(prev).add(id));
    try {
      const { contacted_at } = await setTrainingInterestContacted(id, nextContacted);
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, contacted: nextContacted, contacted_at } : e)));
    } catch (err: unknown) {
      setUpdateError(getErrorMessage(err, 'Failed to update contacted status'));
    } finally {
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/public/training/${campaignId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setUpdateError('Could not copy the link — your browser may not support clipboard access.');
    }
  };

  if (isUserLoading || isLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <LoadingSpinner />
        </div>
      </MobileLayout>
    );
  }

  if (loadError || campaign === null || (campaign && !isTrainingCategory(campaign.category))) {
    return (
      <MobileLayout>
        <div className="p-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-200">
              {loadError ? 'Error' : 'Not Available'}
            </h2>
            <p className="mt-1 text-sm text-red-600 dark:text-red-300">
              {loadError
                || (campaign && !isTrainingCategory(campaign.category)
                  ? 'This campaign is not a BOTJ or TLT training session.'
                  : "This training campaign couldn't be found, or you don't have permission to view it.")}
            </p>
            <button
              onClick={() => router.push('/training-interest')}
              className="mt-4 rounded-md bg-red-600 px-4 py-2 text-base font-bold text-white hover:bg-red-700 border-2 border-gray-800 dark:border-gray-600"
            >
              Go Back
            </button>
          </div>
        </div>
      </MobileLayout>
    );
  }

  if (!campaign) return null; // unreachable, satisfies TS narrowing

  return (
    <MobileLayout>
      <div className="p-4">
        <div className="relative mb-3">
          <button
            onClick={() => router.push('/training-interest')}
            className="absolute right-0 top-0 rounded bg-gray-200 px-1.5 py-0.5 text-xs font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border border-gray-800 dark:border-gray-600"
          >
            Back
          </button>
          <h1 className="pr-14 text-2xl font-bold text-gray-900 dark:text-gray-100">
            {combinePlaceAndSite(campaign.place, campaign.site)} — {campaign.state}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {campaign.category} training, {new Date(campaign.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            {' at '}{formatCampaignTimeDisplay(campaign.time)} — Leader: {campaign.leader}
          </p>
          <button
            type="button"
            onClick={handleCopyLink}
            className="mt-2 rounded-md bg-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
          >
            {copied ? 'Copied!' : 'Copy Public Link'}
          </button>
        </div>

        {updateError && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
            {updateError}
          </div>
        )}

        <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white shadow-sm dark:bg-gray-800">
          <div className="p-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Interested ({entries.length})
            </h2>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {/* No isLoading branch needed here — the page-level gate above
                already blocks rendering until campaign+entries have both
                resolved together (fetched in parallel). */}
            {entries.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                No one has registered interest yet.
              </div>
            ) : (
              entries.map((entry) => {
                const isUpdating = updatingIds.has(entry.id);
                return (
                  <div key={entry.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-base font-bold text-gray-900 dark:text-gray-100">{entry.name}</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {[entry.mobile, entry.email].filter(Boolean).join(' · ')}
                        </div>
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Registered {formatDateTime(entry.created_at)}
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <label className="flex items-center justify-end gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                          <span>Contacted</span>
                          <input
                            type="checkbox"
                            checked={entry.contacted}
                            disabled={isUpdating}
                            onChange={(e) => handleToggleContacted(entry.id, e.target.checked)}
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
