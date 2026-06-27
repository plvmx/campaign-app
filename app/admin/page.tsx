'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { useCampaignDates } from '@/contexts/CampaignDatesContext';
import { formatDateReadable } from '@/lib/campaignDates';
import { supabase } from '@/lib/supabaseClient';
import {
  isCampaignLoggingEnabled, setCampaignLoggingEnabled,
  getSlideViewEnabled, setSlideViewEnabled, type SlideViewRole,
} from '@/lib/appSettings';
import { runWeeklyRefresh } from '@/lib/services/weeklyRefreshService';
import { getErrorMessage } from '@/lib/errorUtils';
import { trackEvent } from '@/lib/analytics';

/** Most-recent row from weekly_refresh_log (new columns may be null on older rows). */
interface LastRefreshInfo {
  completed_at: string;
  triggered_by: string | null;
  campaigns_created: number | null;
  campaigns_deleted: number | null;
  campaigns_skipped: number | null;
  error_message: string | null;
}

export default function AdminPage() {
  const router = useRouter();
  const { dates } = useCampaignDates();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();
  const [hasAccess, setHasAccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [loggingEnabled, setLoggingEnabled] = useState<boolean>(true);
  const [isLoadingLoggingSetting, setIsLoadingLoggingSetting] = useState(true);
  const [isTogglingLogging, setIsTogglingLogging] = useState(false);

  // Slide-view feature flags (one per role)
  const [slideViewValues, setSlideViewValues] = useState({ leaders: false, sr: false, admin: false });
  const [isLoadingSlideView, setIsLoadingSlideView] = useState(true);
  const [isTogglingSlideView, setIsTogglingSlideView] = useState<Partial<Record<SlideViewRole, boolean>>>({});
  const [lastRefresh, setLastRefresh] = useState<LastRefreshInfo | null>(null);
  const [isLoadingLastRefresh, setIsLoadingLastRefresh] = useState(true);

  const fetchLastRefresh = async () => {
    const { data } = await supabase
      .from('weekly_refresh_log')
      .select('completed_at, triggered_by, campaigns_created, campaigns_deleted, campaigns_skipped, error_message')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setLastRefresh(data as LastRefreshInfo | null);
    setIsLoadingLastRefresh(false);
  };

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    if (!isAdmin) {
      setError('You do not have permission to access this page');
      return;
    }
    setHasAccess(true);
    isCampaignLoggingEnabled()
      .then(setLoggingEnabled)
      .finally(() => setIsLoadingLoggingSetting(false));

    Promise.all([
      getSlideViewEnabled('leaders'),
      getSlideViewEnabled('sr'),
      getSlideViewEnabled('admin'),
    ]).then(([leaders, sr, admin]) => {
      setSlideViewValues({ leaders, sr, admin });
    }).finally(() => setIsLoadingSlideView(false));

    fetchLastRefresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUserLoading, user, isAdmin, router]);

  const handleWeeklyRefresh = async () => {
    if (!user) return;

    setIsRefreshing(true);
    setRefreshMessage(null);
    setError(null);

    try {
      const result = await runWeeklyRefresh(supabase, user.id);

      const weekLabel = formatDateReadable(result.secondWeekStart);
      let message = result.created > 0
        ? `Created ${result.created} campaign(s) for the week starting ${weekLabel}. `
        : `No new campaigns for the week starting ${weekLabel}. `;
      if (result.skipped > 0) message += `${result.skipped} already existed and were skipped. `;
      message += `Deleted ${result.deleted} old campaign(s).`;
      setRefreshMessage(message);
      trackEvent('weekly_refresh_manual', { created: result.created, deleted: result.deleted });

      // Refresh last-run info in the card
      await fetchLastRefresh();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to refresh campaigns'));
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleToggleLogging = async () => {
    setIsTogglingLogging(true);
    setError(null);
    
    try {
      const newValue = !loggingEnabled;
      await setCampaignLoggingEnabled(newValue);
      setLoggingEnabled(newValue);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to update logging setting'));
    } finally {
      setIsTogglingLogging(false);
    }
  };

  const handleToggleSlideView = async (role: SlideViewRole) => {
    setIsTogglingSlideView(prev => ({ ...prev, [role]: true }));
    setError(null);
    try {
      const newValue = !slideViewValues[role];
      await setSlideViewEnabled(role, newValue);
      setSlideViewValues(prev => ({ ...prev, [role]: newValue }));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to update slide view setting'));
    } finally {
      setIsTogglingSlideView(prev => ({ ...prev, [role]: false }));
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
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-200">
              Access Denied
            </h2>
            <p className="mt-1 text-sm text-red-600 dark:text-red-300">
              {error || 'You do not have permission to access the admin panel.'}
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
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Admin Panel
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Manage users, permissions, and system settings
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {refreshMessage && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
            <p className="text-sm text-green-800 dark:text-green-200">{refreshMessage}</p>
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

          {/* Weekly Refresh */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            {/* Header row with automation badge */}
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Weekly Refresh
              </h2>
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-900/40 dark:text-green-300">
                🤖 Automated
              </span>
            </div>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Runs automatically every Sunday at 1 AM UTC
            </p>

            {/* Last run info */}
            <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-600 dark:bg-gray-700/50">
              {isLoadingLastRefresh ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">Loading last run…</p>
              ) : lastRefresh ? (
                <div className="text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-700 dark:text-gray-300">Last run</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      lastRefresh.triggered_by === 'auto'
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                        : 'bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-300'
                    }`}>
                      {lastRefresh.triggered_by === 'auto' ? '🤖 auto' : '👤 manual'}
                    </span>
                  </div>
                  <p className="mt-1 text-gray-600 dark:text-gray-400">
                    {new Date(lastRefresh.completed_at).toLocaleString()}
                  </p>
                  {lastRefresh.error_message ? (
                    <p className="mt-1 font-medium text-red-600 dark:text-red-400">
                      ⚠ Failed: {lastRefresh.error_message}
                    </p>
                  ) : (
                    <p className="mt-1 text-gray-600 dark:text-gray-400">
                      {lastRefresh.campaigns_created ?? '—'} created ·{' '}
                      {lastRefresh.campaigns_skipped ?? '—'} skipped ·{' '}
                      {lastRefresh.campaigns_deleted ?? '—'} deleted
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-400">No runs recorded yet.</p>
              )}
            </div>

            <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
              The button below runs the same process as the automated job — it will create
              campaigns and delete old ones immediately. Use it if the automated refresh
              didn&apos;t complete, or to apply newly-added rules without waiting until Sunday.
            </p>
            <button
              onClick={handleWeeklyRefresh}
              disabled={isRefreshing}
              className="mt-4 w-full rounded-md bg-purple-600 px-4 py-2 text-base font-bold text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
            >
              {isRefreshing ? 'Refreshing…' : 'Run Manually'}
            </button>
          </div>

          {/* Campaign Rules Management */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Campaign Rules
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Manage rules for automatic campaign generation. Create rules for recurring campaigns (weekly, biweekly, monthly).
            </p>
            <button
              onClick={() => router.push('/admin/campaign-rules')}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Manage Campaign Rules
            </button>
          </div>

          {/* Campaign Slides */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Campaign Slides
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Generate campaign slides in JPEG format for upcoming campaigns
            </p>
            <button
              onClick={() => router.push('/admin/generate-slides')}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Generate Slides
            </button>
          </div>

          {/* Campaign Map */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Campaign Map
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              View upcoming campaigns on an interactive map of Australia, filterable by date range and state
            </p>
            <button
              onClick={() => router.push('/admin/campaign-map')}
              className="mt-4 block rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              View Campaign Map
            </button>
            <button
              onClick={() => router.push('/admin/campaigns-near-me')}
              className="mt-3 block rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Campaigns Near Me
            </button>
          </div>

          {/* Member Activity */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Member Activity
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              View active member counts (leader + team) by total, state, place or campaign
            </p>
            <button
              onClick={() => router.push('/admin/member-activity')}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              View Member Activity
            </button>
          </div>

          {/* Campaign Results Report */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Campaign Results Report
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Generate a comprehensive campaign results report in landscape JPEG format
            </p>
            <button
              onClick={() => router.push('/admin/generate-report')}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Generate Report
            </button>
          </div>

          {/* Campaign Logs Viewer */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Campaign Change Logs
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              View and search all campaign change records with advanced filtering options
            </p>
            <button
              onClick={() => router.push('/admin/campaign-logs')}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              View Logs
            </button>
          </div>

          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Campaign Messages
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Add special messages to display on campaign slides for specific dates
            </p>
            <button
              onClick={() => router.push('/admin/campaign-messages')}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Manage Campaign Messages
            </button>
          </div>
          
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Campaign Categories
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Manage campaign categories (TWOL, BOTJ, TLT, …)
            </p>
            <button
              onClick={() => router.push('/admin/campaign-categories')}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Manage Categories
            </button>
          </div>

          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              State Places Management
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Manage state-place combinations used in campaigns
            </p>
            <button
              onClick={() => router.push('/admin/state-places')}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Manage State Places
            </button>
          </div>

          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              State Leaders Management
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Manage state-leader combinations with mobile numbers
            </p>
            <button
              onClick={() => router.push('/admin/state-leaders')}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Manage State Leaders
            </button>
          </div>

          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Leader sharing
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Define which leader can see another leader’s campaigns (all current and future)
            </p>
            <button
              onClick={() => router.push('/admin/leader-shares')}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Manage leader sharing
            </button>
          </div>

          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              User Management
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Manage user accounts and permissions
            </p>
            <button
              disabled
              className="mt-4 rounded-md bg-gray-200 px-4 py-2 text-base font-bold text-gray-600 dark:bg-gray-700 dark:text-gray-400 border-2 border-gray-800 dark:border-gray-600"
            >
              Coming Soon
            </button>
          </div>

          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              System Settings
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Configure system-wide settings
            </p>
            
            {/* Slide View Feature Flags */}
            <div className="mt-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Slide-Style View Mode
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                When enabled for a role, the campaign list shows a View/Edit toggle so users
                can switch to the slide-style read-only layout. Disabled roles always see the
                standard edit list.
              </p>
              {(
                [
                  { role: 'leaders', label: 'Team Leaders' },
                  { role: 'sr',      label: 'State Reporters' },
                  { role: 'admin',   label: 'Administrators' },
                ] as { role: SlideViewRole; label: string }[]
              ).map(({ role, label }) => (
                <div
                  key={role}
                  className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-600 dark:bg-gray-700/50"
                >
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {label}
                  </span>
                  <div className="ml-4 shrink-0">
                    {isLoadingSlideView ? (
                      <div className="text-sm text-gray-400 dark:text-gray-500">Loading…</div>
                    ) : (
                      <button
                        onClick={() => handleToggleSlideView(role)}
                        disabled={!!isTogglingSlideView[role]}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                          slideViewValues[role] ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'
                        } ${isTogglingSlideView[role] ? 'opacity-50 cursor-not-allowed' : ''}`}
                        role="switch"
                        aria-checked={slideViewValues[role]}
                        aria-label={`Toggle slide view for ${label}`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            slideViewValues[role] ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="my-4 border-t border-gray-200 dark:border-gray-600" />

            {/* Campaign Logging Toggle */}
            <div className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 p-4 dark:border-gray-600 dark:bg-gray-700/50">
              <div className="flex-1">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  Campaign Change Logging
                </h3>
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  {loggingEnabled 
                    ? 'Logging is enabled. All campaign changes (except from Admin screen) are being recorded.'
                    : 'Logging is disabled. Campaign changes are not being recorded.'}
                </p>
              </div>
              <div className="ml-4">
                {isLoadingLoggingSetting ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">Loading...</div>
                ) : (
                  <button
                    onClick={handleToggleLogging}
                    disabled={isTogglingLogging}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                      loggingEnabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'
                    } ${isTogglingLogging ? 'opacity-50 cursor-not-allowed' : ''}`}
                    role="switch"
                    aria-checked={loggingEnabled}
                    aria-label="Toggle campaign logging"
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        loggingEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Metrics
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Usage analytics, active users, and database row counts
            </p>
            <button
              onClick={() => router.push('/admin/metrics')}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 border-2 border-gray-800 dark:border-gray-600"
            >
              View Metrics
            </button>
          </div>

          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Backup &amp; Restore
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Export a JSON snapshot of campaigns, state leaders, state places, and campaign rules.
              Restore from a backup to recover from data corruption.
            </p>
            <button
              onClick={() => router.push('/admin/backup')}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
            >
              Backup &amp; Restore
            </button>
          </div>
        </div>
      </div>
    </MobileLayout>
  );
}

