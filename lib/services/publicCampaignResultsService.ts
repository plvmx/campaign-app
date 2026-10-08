/**
 * Which campaign week the public Campaign Results link
 * (/public/campaign-results) shows.
 *
 * The page shows the oldest week the last Weekly Refresh left in the
 * database, and keeps showing it until the next refresh runs — not until a
 * fixed weekday. Each refresh deletes every campaign (and its results) dated
 * before `calculateCampaignDates().pastCampaignStart` as of the moment it ran,
 * so re-deriving that same date from the last successful run's timestamp
 * names exactly the week that refresh kept, and the week the *next* refresh
 * will delete. With the Sunday cron that means: the Mon-Sun week just ended
 * is shown from that Sunday's refresh until the following Sunday's.
 *
 * Deliberately not `calculateCampaignDates()` as of "now" (what the admin
 * "Campaign Results" quick action still uses): that flips to the in-progress
 * week every Thursday, three days before the previous week is removed.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { calculateCampaignDates } from '@/lib/campaignDates';

/**
 * `completed_at` of the most recent Weekly Refresh that succeeded (failed
 * runs are logged with an `error_message` and may not have deleted
 * anything). Null if none has been logged. Takes an injected client — the
 * service role in practice, since an anonymous visitor can't read this log.
 */
export async function getLastSuccessfulWeeklyRefreshAt(client: SupabaseClient): Promise<Date | null> {
  const { data, error } = await client
    .from('weekly_refresh_log')
    .select('completed_at')
    .is('error_message', null)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.completed_at ? new Date(data.completed_at) : null;
}

/**
 * Monday of the week the public page shows. Falls back to the current
 * date-based past week when no successful refresh has ever been logged.
 */
export function getDisplayedResultsWeekStart(lastRefreshAt: Date | null, now: Date = new Date()): Date {
  return calculateCampaignDates(lastRefreshAt ?? now).pastCampaignStart;
}
