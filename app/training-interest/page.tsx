'use client';

/**
 * Leader-facing dashboard of training campaigns (category BOTJ/TLT) the
 * signed-in user leads (own, shared, or — for admins — every training
 * campaign), each with its public-link interest count. Click through to
 * /training-interest/[campaignId] for the full list of who's interested.
 *
 * Visibility is enforced the same way as the main campaign feed: RLS on the
 * campaigns table (see supabase/rls-policies.sql) restricts what
 * getTrainingCampaigns can ever return, so a non-admin leader simply never
 * sees another leader's training campaigns here.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { getTrainingCampaigns, getTrainingInterestCounts } from '@/lib/services/trainingInterestService';
import { getSlideStateColor } from '@/lib/slideLayout';
import { formatCampaignTimeDisplay } from '@/lib/campaignUtils';
import { combinePlaceAndSite } from '@/lib/placeSite';
import { getErrorMessage } from '@/lib/errorUtils';
import type { Campaign } from '@/lib/types';

export default function TrainingInterestPage() {
  const router = useRouter();
  const { user, adminStatus, userState, userLeader, userMobile, isLoading: isUserLoading } = useUser();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }

    let cancelled = false;
    Promise.resolve()
      .then(() => {
        setIsLoading(true);
        setLoadError(null);
        return getTrainingCampaigns({ adminStatus, userState, userLeader, userMobile, userId: user.id });
      })
      .then(async (result) => {
        if (cancelled) return;
        setCampaigns(result);
        const countsResult = await getTrainingInterestCounts(result.map((c) => c.id));
        if (!cancelled) setCounts(countsResult);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(getErrorMessage(err, 'Failed to load training campaigns'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [isUserLoading, user, adminStatus, userState, userLeader, userMobile, router]);

  const handleCopyLink = async (campaignId: string) => {
    const url = `${window.location.origin}/public/training/${campaignId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(campaignId);
      setTimeout(() => setCopiedId((prev) => (prev === campaignId ? null : prev)), 2000);
    } catch {
      setLoadError('Could not copy the link — your browser may not support clipboard access.');
    }
  };

  if (isUserLoading || (isLoading && campaigns.length === 0)) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <LoadingSpinner text="Loading training campaigns…" />
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
          <h1 className="pr-14 text-2xl font-bold text-gray-900 dark:text-gray-100">Training Interest</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Your BOTJ and TLT training campaigns, each with a public link people can use to register interest in joining.
          </p>
        </div>

        {loadError && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
            {loadError}
          </div>
        )}

        <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white shadow-sm dark:bg-gray-800">
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {campaigns.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                No BOTJ or TLT training campaigns found.
              </div>
            ) : (
              campaigns.map((campaign) => (
                <div key={campaign.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => router.push(`/training-interest/${campaign.id}`)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="font-bold" style={{ color: getSlideStateColor(campaign.state) }}>
                        {combinePlaceAndSite(campaign.place, campaign.site)} — {campaign.state}
                        <span className="ml-2 rounded-md bg-blue-600 px-1.5 py-0.5 text-xs font-bold text-white">
                          {campaign.category}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        {new Date(campaign.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                        {' at '}{formatCampaignTimeDisplay(campaign.time)} — Leader: {campaign.leader}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-blue-700 dark:text-blue-300">
                        {counts.get(campaign.id) ?? 0} interested — View details →
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopyLink(campaign.id)}
                      className="shrink-0 rounded-md bg-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
                    >
                      {copiedId === campaign.id ? 'Copied!' : 'Copy Link'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </MobileLayout>
  );
}
