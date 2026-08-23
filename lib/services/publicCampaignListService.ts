/**
 * Shared data fetch for the public, unauthenticated "current fortnight, all
 * states" campaign list — the same underlying dataset behind both
 * `/api/public/temporary-upcoming-campaigns` and `/api/public/final-campaign-lists`.
 * Those two pages differ only in copy and available actions (Edit+Download vs
 * Download-only); the query, date range, and response shape are identical, so
 * it lives here once rather than being duplicated per route.
 */
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { calculateCampaignDates, formatDateForDb, getFortnightDateRange } from '@/lib/campaignDates';
import type { SlideCampaign, PublicSlideDay } from '@/lib/slideGenerator';

/**
 * The upcoming fortnight's dates, formatted for the DB. Cheap (no DB call) —
 * callers use `dateStrings[0]` as a short-lived cache key so they can skip
 * the actual query (fetchFortnightCampaignDays) on a cache hit.
 */
export function getUpcomingFortnightDateStrings(): string[] {
  const { upcomingCampaignStart } = calculateCampaignDates();
  return getFortnightDateRange(upcomingCampaignStart).map(formatDateForDb);
}

/**
 * Fetches the given dates' campaigns (all states) plus each day's
 * campaign_messages banner text, shaped for generateAndDownloadSlidesFromData
 * (lib/slideGenerator.ts) — one fetch powers both an on-screen list and its
 * ZIP download. Pass `getUpcomingFortnightDateStrings()`.
 *
 * mobile is hard-coded null on every campaign — this data is served to
 * anonymous callers and must never carry a phone number.
 */
export async function fetchFortnightCampaignDays(dateStrings: string[]): Promise<PublicSlideDay[]> {
  const [campaignsResult, messagesResult] = await Promise.all([
    supabaseAdmin
      .from('campaigns')
      .select('id, date, state, place, site, time, leader, category')
      .gte('date', dateStrings[0])
      .lte('date', dateStrings[dateStrings.length - 1])
      .order('date', { ascending: true })
      .order('state', { ascending: true })
      .order('place', { ascending: true })
      .order('time', { ascending: true }),
    supabaseAdmin
      .from('campaign_messages')
      .select('date, message')
      .gte('date', dateStrings[0])
      .lte('date', dateStrings[dateStrings.length - 1]),
  ]);

  if (campaignsResult.error) {
    throw new Error(`campaigns query failed: ${campaignsResult.error.message}`);
  }
  if (messagesResult.error) {
    throw new Error(`campaign_messages query failed: ${messagesResult.error.message}`);
  }

  const campaigns = campaignsResult.data ?? [];
  const messageByDate = new Map<string, string>(
    (messagesResult.data ?? []).map((m: { date: string; message: string }) => [m.date, m.message]),
  );

  return dateStrings.map((date) => ({
    date,
    campaigns: campaigns
      .filter((c) => c.date === date)
      .map((c): SlideCampaign => ({ ...c, mobile: null })),
    message: messageByDate.get(date) ?? null,
  }));
}
