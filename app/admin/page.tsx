'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import { useUser } from '@/contexts/UserContext';
import { useCampaignDates } from '@/contexts/CampaignDatesContext';
import { formatDateReadable, formatDateForDb } from '@/lib/campaignDates';
import { supabase } from '@/lib/supabaseClient';
import { isCampaignLoggingEnabled, setCampaignLoggingEnabled } from '@/lib/appSettings';
import { CampaignRule, evaluateRules } from '@/lib/campaignRules';
import { getErrorMessage } from '@/lib/errorUtils';

/** Shape of a campaign row being prepared for DB insert (no id/created_at yet). */
interface NewCampaignRow {
  date: string;
  state: string;
  place: string;
  time: string;
  leader: string;
  mobile: string | null;
  botj: string | null;
  category: string | null;
  user_id: string | null | undefined;
  team_size: null;
  tl_ok: boolean;
  sr_ok?: boolean;
  source: string;
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
  }, [isUserLoading, user, isAdmin, router]);

  const handleWeeklyRefresh = async () => {
    if (!dates || !user) return;

    setIsRefreshing(true);
    setRefreshMessage(null);
    setError(null);

    try {
      const secondWeekStart = new Date(dates.secondWeekStart);
      const secondWeekEnd = new Date(secondWeekStart);
      secondWeekEnd.setDate(secondWeekEnd.getDate() + 6); // Single week (Mon–Sun)

      const secondWeekStartStr = formatDateForDb(secondWeekStart);
      const secondWeekEndStr = formatDateForDb(secondWeekEnd);

      // Distinct states from state_leaders
      const { data: stateRows, error: statesError } = await supabase
        .from('state_leaders')
        .select('state');
      if (statesError) throw statesError;
      const states = Array.from(new Set((stateRows || []).map((r: { state: string }) => r.state)));

      // Fetch all active rules once
      const { data: fetchedRules, error: rulesError } = await supabase
        .from('campaign_rules')
        .select('*')
        .eq('is_active', true)
        .order('priority', { ascending: false });
      if (rulesError) throw rulesError;
      const allRules = (fetchedRules || []) as CampaignRule[];

      // Fetch existing campaigns in target week to avoid duplicate inserts
      const { data: existingInTargetWeek, error: existingError } = await supabase
        .from('campaigns')
        .select('date, state, place, time, leader')
        .gte('date', secondWeekStartStr)
        .lte('date', secondWeekEndStr);
      if (existingError) throw existingError;
      const existingSlotKeys = new Set(
        (existingInTargetWeek || []).map(
          (c: { date: string; state: string; place: string; time: string; leader: string }) =>
            `${c.date}_${c.state}_${c.place}_${c.time}_${c.leader}`
        )
      );

      // Biweekly rules: backfill reference_date from existing campaigns where missing
      for (const rule of allRules) {
        if (rule.frequency_type === 'biweekly' && !rule.rule_config?.reference_date) {
          const { data: existingCampaigns, error: existingError } = await supabase
            .from('campaigns')
            .select('date')
            .eq('state', rule.state)
            .eq('place', rule.place)
            .eq('time', rule.time)
            .eq('leader', rule.leader)
            .order('date', { ascending: false })
            .limit(1);
          if (!existingError && existingCampaigns?.length > 0) {
            rule.rule_config = rule.rule_config || {};
            rule.rule_config.reference_date = existingCampaigns[0].date;
          }
        }
      }

      const allNewCampaigns: NewCampaignRow[] = [];
      let rulesCount = 0;
      const rulesUsedInRefresh: CampaignRule[] = [];

      for (const state of states) {
        const stateRules = allRules.filter((r) => r.state === state);
        const ruleCampaigns = evaluateRules(stateRules, secondWeekStart, secondWeekEnd);
        const generatedForState: NewCampaignRow[] = ruleCampaigns.map((campaign) => ({
          date: campaign.date,
          state: campaign.state,
          place: campaign.place,
          time: campaign.time,
          leader: campaign.leader,
          mobile: campaign.mobile,
          botj: null,
          category: campaign.category ?? 'TWOL',
          user_id: user.id,
          team_size: null,
          tl_ok: false,
          source: 'RUL',
        }));
        rulesCount += generatedForState.length;
        rulesUsedInRefresh.push(...stateRules);
        allNewCampaigns.push(...generatedForState);
      }

      if (allNewCampaigns.length === 0) {
        setRefreshMessage('No campaigns to create. Check your campaign rules.');
        return;
      }

      // Skip campaigns that already exist (same date, state, place, time, leader)
      const slotKey = (c: { date: string; state: string; place: string; time: string; leader: string }) =>
        `${c.date}_${c.state}_${c.place}_${c.time}_${c.leader}`;
      const toInsert = allNewCampaigns.filter((c) => !existingSlotKeys.has(slotKey(c)));
      const skippedCount = allNewCampaigns.length - toInsert.length;

      if (toInsert.length === 0) {
        setRefreshMessage(
          skippedCount > 0
            ? `No new campaigns created; ${skippedCount} already existed for the week starting ${formatDateReadable(secondWeekStart)}.`
            : 'No campaigns to create. Check your campaign rules.'
        );
        return;
      }

      const { error: insertError } = await supabase
        .from('campaigns')
        .insert(toInsert);
      if (insertError) throw insertError;

      // Update biweekly rule reference_date for rules that generated campaigns
      for (const rule of rulesUsedInRefresh) {
        if (rule.frequency_type === 'biweekly') {
          const ruleCampaigns = toInsert.filter(
            (c) =>
              c.state === rule.state &&
              c.place === rule.place &&
              c.time === rule.time &&
              c.leader === rule.leader
          );
          if (ruleCampaigns.length > 0) {
            const newReferenceDate = ruleCampaigns.map((c) => c.date).sort()[0];
            await supabase
              .from('campaign_rules')
              .update({
                rule_config: { ...(rule.rule_config || {}), reference_date: newReferenceDate },
              })
              .eq('id', rule.id);
          }
        }
      }

      const pastWeekStartStrDel = formatDateForDb(dates.pastCampaignStart);
      const { data: deletedCampaigns, error: deleteError } = await supabase
        .from('campaigns')
        .delete()
        .lt('date', pastWeekStartStrDel)
        .select();
      if (deleteError) throw deleteError;
      const deletedCount = deletedCampaigns?.length || 0;

      const { error: logError } = await supabase
        .from('weekly_refresh_log')
        .insert({ completed_at: new Date().toISOString(), created_by: user?.id ?? null });
      if (logError) {
        // Non-fatal: refresh completed but logging failed — silently ignore
      }

      let message = `Successfully created ${toInsert.length} campaign(s) for the week starting ${formatDateReadable(secondWeekStart)}. `;
      message += `Generated ${rulesCount} from rules. `;
      if (skippedCount > 0) message += `${skippedCount} already existed and were skipped. `;
      message += `Deleted ${deletedCount} old campaign(s).`;
      setRefreshMessage(message);
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

  if (isUserLoading) {
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
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Weekly Refresh
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Generate campaigns for the second week period from campaign rules, and clean up old campaigns.
            </p>
            <button
              onClick={handleWeeklyRefresh}
              disabled={isRefreshing || !dates}
              className="mt-4 w-full rounded-md bg-purple-600 px-4 py-2 text-base font-bold text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
            >
              {isRefreshing ? 'Refreshing...' : 'Weekly Refresh'}
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
            
            {/* Campaign Logging Toggle */}
            <div className="mt-4 flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 p-4 dark:border-gray-600 dark:bg-gray-700/50">
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
              Analytics
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              View system-wide analytics and reports
            </p>
            <button
              disabled
              className="mt-4 rounded-md bg-gray-200 px-4 py-2 text-base font-bold text-gray-600 dark:bg-gray-700 dark:text-gray-400 border-2 border-gray-800 dark:border-gray-600"
            >
              Coming Soon
            </button>
          </div>
        </div>
      </div>
    </MobileLayout>
  );
}

