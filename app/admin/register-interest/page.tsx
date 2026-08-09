'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { useCampaignDates } from '@/contexts/CampaignDatesContext';
import { AUSTRALIAN_STATES, type AustralianState } from '@/lib/constants';
import { formatDateForDb, formatWeekDateRangeString } from '@/lib/campaignDates';
import { getCampaignsByDateRange } from '@/lib/services/campaignService';
import { isCampaignPast } from '@/lib/campaignUtils';
import { getErrorMessage } from '@/lib/errorUtils';
import type { Campaign } from '@/lib/types';
import CampaignCheckboxList from './components/CampaignCheckboxList';
import InterestSummaryModal from './components/InterestSummaryModal';

export default function RegisterInterestPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();
  const { dates: campaignDates } = useCampaignDates();
  const [hasAccess, setHasAccess] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  // Week 1 is the upcoming campaign week; Week 2 is the one after it. The
  // toggle below picks which week's campaigns are queried — Week 1 by default.
  const [selectedWeek, setSelectedWeek] = useState<1 | 2>(1);

  const weeks = useMemo(() => {
    if (!campaignDates) return null;
    const week1Start = campaignDates.upcomingCampaignStart;
    const week2Start = campaignDates.secondWeekStart;
    return {
      1: { startDate: formatDateForDb(week1Start), rangeText: formatWeekDateRangeString(week1Start) },
      2: { startDate: formatDateForDb(week2Start), rangeText: formatWeekDateRangeString(week2Start) },
    };
  }, [campaignDates]);

  const { startDate, endDate } = useMemo(() => {
    if (!weeks) return { startDate: '', endDate: '' };
    const start = weeks[selectedWeek].startDate;
    const [y, m, d] = start.split('-').map(Number);
    const end = new Date(y, m - 1, d + 6);
    return { startDate: start, endDate: formatDateForDb(end) };
  }, [weeks, selectedWeek]);

  const [selectedState, setSelectedState] = useState<AustralianState | ''>('');

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const toggleChecked = (id: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const [popupAction, setPopupAction] = useState<'in' | 'more' | null>(null);

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
    if (!startDate || !endDate) return;

    let cancelled = false;

    Promise.resolve()
      .then(() => {
        setIsLoadingCampaigns(true);
        setLoadError(null);
        return getCampaignsByDateRange({ startDate, endDate, state: selectedState || undefined });
      })
      .then(result => {
        if (cancelled) return;
        // Campaigns that have already started or finished are excluded — this
        // screen is for finding upcoming campaigns to register interest in.
        setCampaigns(result.filter(campaign => !isCampaignPast(campaign.date, campaign.time)));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(getErrorMessage(err, 'Failed to load campaigns'));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingCampaigns(false);
      });

    return () => { cancelled = true; };
  }, [hasAccess, startDate, endDate, selectedState]);

  // Ticked campaigns can go stale (e.g. a place drops out of the filtered set
  // when the state filter changes) — drop any checked id no longer in view.
  // setState is deferred through a resolved Promise to avoid synchronous setState
  // inside the effect body, matching the pattern used elsewhere in the app.
  useEffect(() => {
    Promise.resolve().then(() => {
      setCheckedIds(prev => {
        const visibleIds = new Set(campaigns.map(c => c.id));
        let changed = false;
        const next = new Set<string>();
        for (const id of prev) {
          if (visibleIds.has(id)) {
            next.add(id);
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
  }, [campaigns]);

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
      {/* Same height calc as the campaign map screen — see that page for why
          100dvh and the PWA-banner var are needed. */}
      <div className="flex h-[calc(100dvh-var(--pwa-banner-height,0px)-4rem-5rem)] flex-col p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Upcoming AFJ Campaigns</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Tick the campaigns below that you&apos;d like to be part of, then use the buttons at the bottom to register your interest or ask for more details.
            </p>
          </div>
          <button
            onClick={() => router.push('/admin')}
            className="shrink-0 rounded-md bg-gray-200 px-3 py-2 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
          >
            Back
          </button>
        </div>

        {weeks && (
          <div className="mb-3 flex gap-2">
            {([1, 2] as const).map(week => (
              <button
                key={week}
                type="button"
                onClick={() => setSelectedWeek(week)}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold border-2 transition-colors ${
                  selectedWeek === week
                    ? 'bg-blue-600 text-white border-blue-700'
                    : 'bg-white text-gray-700 border-gray-400 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700'
                }`}
              >
                {week === 1 ? 'This Week' : 'Next Week'}
              </button>
            ))}
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select
            value={selectedState}
            onChange={e => setSelectedState(e.target.value as AustralianState | '')}
            className="rounded-md border-2 border-gray-800 bg-white px-3 py-2 text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">All states</option>
            {AUSTRALIAN_STATES.map(state => (
              <option key={state} value={state}>{state}</option>
            ))}
          </select>
          {weeks && (
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {weeks[selectedWeek].rangeText}
            </span>
          )}
        </div>

        {loadError && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
            {loadError}
          </div>
        )}

        {/* Campaign lines box — the list scrolls inside here so the two
            buttons below always stay visible on screen. */}
        <div className="relative flex-1 overflow-hidden rounded-lg border-2 border-gray-800 dark:border-gray-600">
          {isLoadingCampaigns && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80 dark:bg-gray-900/80">
              <LoadingSpinner text="Loading campaigns…" />
            </div>
          )}
          <div className="h-full overflow-y-auto">
            <CampaignCheckboxList campaigns={campaigns} checkedIds={checkedIds} onToggle={toggleChecked} />
          </div>
        </div>

        {/* Bottom action buttons — outside the campaign lines box, stretching
            the full width of the screen. */}
        <div className="mt-3 flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setPopupAction('in')}
            className="flex-1 rounded-md bg-green-600 px-4 py-3 text-base font-bold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
          >
            Yes I&apos;m In
          </button>
          <button
            type="button"
            onClick={() => setPopupAction('more')}
            className="flex-1 rounded-md bg-blue-600 px-4 py-3 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
          >
            Tell Me More
          </button>
        </div>
      </div>

      {popupAction && (
        <InterestSummaryModal
          action={popupAction}
          count={checkedIds.size}
          onClose={() => setPopupAction(null)}
        />
      )}
    </MobileLayout>
  );
}
