'use client';

/**
 * Leader-facing dashboard of everyone who has registered interest (via the
 * public /public/register-interest link) in campaigns the signed-in user
 * leads (own, shared, or — for admins — every campaign). Reached from the
 * "Manage my Campaign Interest" button on the post-login action chooser
 * (app/login/page.tsx), shown only when this list is non-empty. Also reached
 * from the "N people interested" callout on a campaign's card in the main
 * feed (app/app/components/CampaignCard.tsx), via an optional ?campaignId=
 * query param that filters this list down to just that campaign.
 *
 * Unlike /training-interest (which drills into one campaign at a time, since
 * each training campaign has its own public link), campaign interest is
 * registered through a single shared public link covering every upcoming
 * campaign — so this is one flat list, closer in shape to the admin-wide
 * /admin/registered-interest, but scoped to the signed-in leader's own
 * campaigns via campaign_interest's RLS (see supabase/rls-policies.sql) and
 * getCampaignInterestForLeader.
 */
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import CampaignInterestEntryList from '@/components/CampaignInterestEntryList';
import { useUser } from '@/contexts/UserContext';
import {
  getCampaignInterestForLeader,
  setCampaignInterestContacted,
  type CampaignInterestWithCampaign,
} from '@/lib/services/campaignInterestService';
import { getErrorMessage } from '@/lib/errorUtils';

function CampaignInterestPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const campaignIdFilter = searchParams.get('campaignId');
  const { user, adminStatus, userState, userLeader, userMobile, isLoading: isUserLoading } = useUser();

  const [entries, setEntries] = useState<CampaignInterestWithCampaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }

    let cancelled = false;
    Promise.resolve()
      .then(() => {
        setIsLoading(true);
        setLoadError(null);
        return getCampaignInterestForLeader({ adminStatus, userState, userLeader, userMobile, userId: user.id });
      })
      .then((result) => {
        if (!cancelled) setEntries(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(getErrorMessage(err, 'Failed to load campaign interest'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [isUserLoading, user, adminStatus, userState, userLeader, userMobile, router]);

  const handleToggleContacted = async (id: string, nextContacted: boolean) => {
    setUpdateError(null);
    setUpdatingIds((prev) => new Set(prev).add(id));
    try {
      const { contacted_at } = await setCampaignInterestContacted(id, nextContacted);
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

  const displayedEntries = campaignIdFilter
    ? entries.filter((e) => e.campaign_id === campaignIdFilter)
    : entries;

  if (isUserLoading || isLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <LoadingSpinner text="Loading campaign interest…" />
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="p-4">
        <div className="relative mb-3">
          <button
            onClick={() => router.push('/app')}
            className="absolute right-0 top-0 rounded bg-gray-200 px-1.5 py-0.5 text-xs font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border border-gray-800 dark:border-gray-600"
          >
            Back
          </button>
          <h1 className="pr-14 text-2xl font-bold text-gray-900 dark:text-gray-100">Campaign Interest ({displayedEntries.length})</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {campaignIdFilter ? (
              <>
                Showing registrations for this campaign only.{' '}
                <button type="button" onClick={() => router.push('/campaign-interest')} className="font-semibold text-blue-700 underline dark:text-blue-300">
                  View all my campaigns
                </button>
              </>
            ) : (
              <>Members who have registered interest in your campaigns via the public Register Interest link. Tick Contacted once you&apos;ve followed up with them.</>
            )}
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
            <CampaignInterestEntryList entries={displayedEntries} updatingIds={updatingIds} onToggleContacted={handleToggleContacted} />
          </div>
        </div>
      </div>
    </MobileLayout>
  );
}

export default function CampaignInterestPage() {
  return (
    <Suspense
      fallback={
        <MobileLayout>
          <div className="flex min-h-screen items-center justify-center">
            <LoadingSpinner />
          </div>
        </MobileLayout>
      }
    >
      <CampaignInterestPageContent />
    </Suspense>
  );
}
