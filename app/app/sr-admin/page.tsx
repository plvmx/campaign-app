'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import { getCurrentUser } from '@/lib/auth';
import { getUserAdminStatusAndMobile } from '@/lib/campaignFilter';
import { getUserProfile } from '@/lib/userProfile';
import { getLeadersNotSignedInSinceRefreshByState, type LeaderNotSignedIn } from '@/lib/weeklyRefresh';
import { getStateRefreshMode, setStateRefreshMode, type RefreshMode } from '@/lib/stateRefreshSettings';
import { useCampaignDates } from '@/contexts/CampaignDatesContext';
import { formatDateReadable } from '@/lib/campaignDates';

export default function SRAdminPage() {
  const router = useRouter();
  const { dates } = useCampaignDates();
  const [isLoading, setIsLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [userState, setUserState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leadersNotSignedIn, setLeadersNotSignedIn] = useState<LeaderNotSignedIn[]>([]);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const [loadingLeaders, setLoadingLeaders] = useState(false);
  const [refreshMode, setRefreshMode] = useState<RefreshMode>('either');
  const [loadingRefreshMode, setLoadingRefreshMode] = useState(false);
  const [savingRefreshMode, setSavingRefreshMode] = useState(false);
  const [refreshModeMessage, setRefreshModeMessage] = useState<string | null>(null);

  useEffect(() => {
    async function checkAccess() {
      try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
          router.push('/login');
          return;
        }
        const { admin, state } = await getUserAdminStatusAndMobile();
        if (admin !== 'SR') {
          setError('You do not have permission to access SR Admin.');
          return;
        }
        const stateToUse = state ?? (await getUserProfile())?.state ?? null;
        setUserState(stateToUse);
        setHasAccess(true);
      } catch (err: any) {
        setError(err.message || 'Access denied');
      } finally {
        setIsLoading(false);
      }
    }
    checkAccess();
  }, [router]);

  useEffect(() => {
    if (!hasAccess || !userState) return;
    let cancelled = false;
    setLoadingLeaders(true);
    getLeadersNotSignedInSinceRefreshByState(userState)
      .then(({ leaders, lastRefreshAt: at }) => {
        if (!cancelled) {
          setLeadersNotSignedIn(leaders);
          setLastRefreshAt(at);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLeadersNotSignedIn([]);
          setLastRefreshAt(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingLeaders(false);
      });
    return () => { cancelled = true; };
  }, [hasAccess, userState]);

  // Load current weekly refresh mode for this state
  useEffect(() => {
    if (!hasAccess || !userState) return;
    let cancelled = false;
    setLoadingRefreshMode(true);
    getStateRefreshMode(userState)
      .then((mode) => {
        if (!cancelled) setRefreshMode(mode);
      })
      .catch(() => {
        if (!cancelled) setRefreshMode('either');
      })
      .finally(() => {
        if (!cancelled) setLoadingRefreshMode(false);
      });
    return () => { cancelled = true; };
  }, [hasAccess, userState]);

  const handleSaveRefreshMode = async () => {
    if (!userState) return;
    setSavingRefreshMode(true);
    setRefreshModeMessage(null);
    setError(null);
    try {
      const currentUser = await getCurrentUser();
      await setStateRefreshMode(userState, refreshMode, currentUser?.id ?? null);
      setRefreshModeMessage('Saved. This mode will be used when an admin runs Weekly Refresh for your state.');
    } catch (err: any) {
      setError(err.message || 'Failed to save refresh mode');
    } finally {
      setSavingRefreshMode(false);
    }
  };

  if (isLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-gray-600 dark:text-gray-400">Loading...</div>
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
            <p className="mt-1 text-sm text-red-600 dark:text-red-300">{error}</p>
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

  const stateToUse = userState ?? '';

  return (
    <MobileLayout>
      <div className="p-4 pb-24">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            State Reporter Admin
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            State Reporter admin options for your state
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          {/* Campaign Dates Info */}
          {dates && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 shadow-sm dark:border-blue-800 dark:bg-blue-900/20">
              <h2 className="text-lg font-semibold text-blue-900 dark:text-blue-100">
                Campaign Date Periods
              </h2>
              <p className="mt-2 text-sm text-blue-800 dark:text-blue-200">
                These dates are automatically calculated based on the current day of the week
              </p>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium text-blue-900 dark:text-blue-100">Past Campaign Start:</span>
                  <span className="text-blue-800 dark:text-blue-200">{formatDateReadable(dates.pastCampaignStart)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-blue-900 dark:text-blue-100">Upcoming Campaign Start:</span>
                  <span className="text-blue-800 dark:text-blue-200">{formatDateReadable(dates.upcomingCampaignStart)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-blue-900 dark:text-blue-100">Second Week Start:</span>
                  <span className="text-blue-800 dark:text-blue-200">{formatDateReadable(dates.secondWeekStart)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Campaign Rules */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Campaign Rules
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Manage rules for automatic campaign generation. Create rules for recurring campaigns (weekly, biweekly, monthly) for your state.
            </p>
            <button
              onClick={() => router.push(`/admin/campaign-rules?state=${encodeURIComponent(stateToUse)}`)}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Manage Campaign Rules
            </button>
          </div>

          {/* Weekly Refresh Mode */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Weekly Refresh Mode
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Choose how campaigns are created for your state when an admin runs Weekly Refresh. Either: copy from past week only when there is no rule for that leader/place/time; otherwise the rule runs and nothing is copied for that campaign.
            </p>
            {loadingRefreshMode ? (
              <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading…</p>
            ) : (
              <div className="mt-4 space-y-3">
                <div>
                  <label htmlFor="sr-refresh-mode" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Refresh mode for {stateToUse}
                  </label>
                  <select
                    id="sr-refresh-mode"
                    value={refreshMode}
                    onChange={(e) => setRefreshMode(e.target.value as RefreshMode)}
                    className="block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                  >
                    <option value="either">Either (Copy if no Rule for Campaign)</option>
                    <option value="copy">Copy from Past Week</option>
                    <option value="rules">Generate from Rules Only</option>
                    <option value="both">Both (Rules override conflicts)</option>
                  </select>
                </div>
                {refreshModeMessage && (
                  <p className="text-sm text-green-700 dark:text-green-300">{refreshModeMessage}</p>
                )}
                <button
                  onClick={handleSaveRefreshMode}
                  disabled={savingRefreshMode}
                  className="rounded-md bg-purple-600 px-4 py-2 text-base font-bold text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-70 border-2 border-gray-800 dark:border-gray-600"
                >
                  {savingRefreshMode ? 'Saving…' : 'Save Refresh Mode'}
                </button>
              </div>
            )}
          </div>

          {/* Campaign Slides */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Campaign Slides
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Generate campaign slides in JPEG format for upcoming campaigns in your state.
            </p>
            <button
              type="button"
              onClick={() => { window.location.href = '/admin/generate-slides'; }}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Generate Slides
            </button>
          </div>

          {/* Campaign Results Report */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Campaign Results Report
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Generate a comprehensive campaign results report in landscape JPEG format for your state.
            </p>
            <button
              type="button"
              onClick={() => { window.location.href = '/admin/generate-report'; }}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Generate Report
            </button>
          </div>

          {/* Leaders not signed in since refresh */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Leaders not signed in since refresh
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Leaders in your state who have not signed in since the last Weekly Refresh (admins and state reporters excluded). No refresh has been run yet if no date is shown.
            </p>
            {loadingLeaders ? (
              <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading…</p>
            ) : (
              (() => {
                const filtered = leadersNotSignedIn.filter((row) => row.admin !== 'AD' && row.admin !== 'SR');
                return (
                  <div className="mt-4 space-y-2">
                    {lastRefreshAt && (
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Last refresh: {lastRefreshAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                      </p>
                    )}
                    {filtered.length === 0 ? (
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {lastRefreshAt ? 'All leaders in your state have signed in since the last refresh.' : 'No refresh run yet, or no leaders in your state.'}
                      </p>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {filtered.length} leader{filtered.length !== 1 ? 's' : ''} not signed in since refresh
                        </p>
                        <ul className="max-h-48 overflow-y-auto rounded border border-gray-300 dark:border-gray-600 divide-y divide-gray-200 dark:divide-gray-600 text-sm">
                          {filtered.map((row) => (
                            <li key={row.id} className="px-3 py-2 flex justify-between items-center gap-2 text-gray-800 dark:text-gray-200">
                              <span className="font-medium truncate">{row.leader}</span>
                              <span className="text-right text-gray-500 dark:text-gray-400 shrink-0">{row.mobile ?? '—'}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                );
              })()
            )}
          </div>
        </div>
      </div>
    </MobileLayout>
  );
}
