/**
 * Weekly Refresh Service
 *
 * Contains the core logic for generating the next week's campaigns from rules,
 * deduplicating against existing rows, and pruning old campaigns.
 *
 * Designed to be called from both:
 *   - The admin UI  (passes the anon Supabase client + the user's ID)
 *   - The Vercel Cron API route  (passes the service-role client + null userId)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { calculateCampaignDates, formatDateForDb } from '@/lib/campaignDates';
import { type CampaignRule, evaluateRules } from '@/lib/campaignRules';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NewCampaignRow {
  date: string;
  state: string;
  place: string;
  time: string;
  leader: string;
  mobile: string | null;
  botj: string | null;
  category: string | null;
  user_id: string | null;
  team_size: null;
  tl_ok: boolean;
  source: string;
}

export interface WeeklyRefreshResult {
  /** Campaigns actually inserted this run. */
  created: number;
  /** Campaigns skipped because they already existed in the target week. */
  skipped: number;
  /** Old campaigns deleted (older than pastCampaignStart). */
  deleted: number;
  /** Start of the week that was targeted. */
  secondWeekStart: Date;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Runs the weekly campaign refresh.
 *
 * Steps:
 *  1. Evaluate active campaign rules for the second upcoming week.
 *  2. Deduplicate against existing campaigns in that week.
 *  3. Insert new campaigns.
 *  4. Update biweekly rule reference_dates.
 *  5. Delete campaigns older than pastCampaignStart (always — even if nothing was inserted).
 *  6. Write an enriched row to weekly_refresh_log.
 *
 * @param client     Supabase client. Use service-role for cron, anon for manual.
 * @param userId     Authenticated user ID (manual runs) or null (automated cron).
 */
export async function runWeeklyRefresh(
  client: SupabaseClient,
  userId: string | null
): Promise<WeeklyRefreshResult> {
  const triggeredBy = userId ? 'manual' : 'auto';

  // -------------------------------------------------------------------------
  // Compute target date windows
  // -------------------------------------------------------------------------
  const { secondWeekStart, pastCampaignStart } = calculateCampaignDates();

  const secondWeekEnd = new Date(secondWeekStart);
  secondWeekEnd.setDate(secondWeekEnd.getDate() + 6); // Mon – Sun

  const secondWeekStartStr = formatDateForDb(secondWeekStart);
  const secondWeekEndStr   = formatDateForDb(secondWeekEnd);
  const pastCampaignStartStr = formatDateForDb(pastCampaignStart);

  try {
    // -----------------------------------------------------------------------
    // Fetch states, active rules, and existing campaigns in target week
    // -----------------------------------------------------------------------
    const { data: stateRows, error: statesError } = await client
      .from('state_leaders')
      .select('state');
    if (statesError) throw statesError;
    const states = Array.from(
      new Set((stateRows || []).map((r: { state: string }) => r.state))
    );

    const { data: fetchedRules, error: rulesError } = await client
      .from('campaign_rules')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: false });
    if (rulesError) throw rulesError;
    const allRules = (fetchedRules || []) as CampaignRule[];

    const { data: existingRows, error: existingError } = await client
      .from('campaigns')
      .select('date, state, place, time, leader')
      .gte('date', secondWeekStartStr)
      .lte('date', secondWeekEndStr);
    if (existingError) throw existingError;

    const existingSlotKeys = new Set(
      (existingRows || []).map(
        (c: { date: string; state: string; place: string; time: string; leader: string }) =>
          `${c.date}_${c.state}_${c.place}_${c.time}_${c.leader}`
      )
    );

    // -----------------------------------------------------------------------
    // Biweekly rules: backfill reference_date from the most recent campaign
    // -----------------------------------------------------------------------
    for (const rule of allRules) {
      if (rule.frequency_type === 'biweekly' && !rule.rule_config?.reference_date) {
        const { data: recent, error: recentError } = await client
          .from('campaigns')
          .select('date')
          .eq('state', rule.state)
          .eq('place', rule.place)
          .eq('time', rule.time)
          .eq('leader', rule.leader)
          .order('date', { ascending: false })
          .limit(1);
        if (!recentError && recent?.length > 0) {
          rule.rule_config = rule.rule_config || {};
          rule.rule_config.reference_date = recent[0].date;
        }
      }
    }

    // -----------------------------------------------------------------------
    // Evaluate rules for all states
    // -----------------------------------------------------------------------
    const allNewCampaigns: NewCampaignRow[] = [];
    const rulesUsedInRefresh: CampaignRule[] = [];

    for (const state of states) {
      const stateRules = allRules.filter((r) => r.state === state);
      const ruleCampaigns = evaluateRules(stateRules, secondWeekStart, secondWeekEnd);

      allNewCampaigns.push(
        ...ruleCampaigns.map((campaign) => ({
          date:      campaign.date,
          state:     campaign.state,
          place:     campaign.place,
          time:      campaign.time,
          leader:    campaign.leader,
          mobile:    campaign.mobile,
          botj:      null,
          category:  campaign.category ?? 'TWOL',
          user_id:   userId,
          team_size: null as null,
          tl_ok:     false,
          source:    'RUL',
        }))
      );
      rulesUsedInRefresh.push(...stateRules);
    }

    // -----------------------------------------------------------------------
    // Deduplicate and insert
    // -----------------------------------------------------------------------
    const slotKey = (c: { date: string; state: string; place: string; time: string; leader: string }) =>
      `${c.date}_${c.state}_${c.place}_${c.time}_${c.leader}`;

    const toInsert    = allNewCampaigns.filter((c) => !existingSlotKeys.has(slotKey(c)));
    const skippedCount = allNewCampaigns.length - toInsert.length;

    let createdCount = 0;
    if (toInsert.length > 0) {
      const { error: insertError } = await client.from('campaigns').insert(toInsert);
      if (insertError) throw insertError;
      createdCount = toInsert.length;

      // Update biweekly reference_dates for rules that generated new campaigns
      for (const rule of rulesUsedInRefresh) {
        if (rule.frequency_type === 'biweekly') {
          const inserted = toInsert.filter(
            (c) =>
              c.state  === rule.state  &&
              c.place  === rule.place  &&
              c.time   === rule.time   &&
              c.leader === rule.leader
          );
          if (inserted.length > 0) {
            const newReferenceDate = inserted.map((c) => c.date).sort()[0];
            await client
              .from('campaign_rules')
              .update({ rule_config: { ...(rule.rule_config || {}), reference_date: newReferenceDate } })
              .eq('id', rule.id);
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // Always delete old campaigns (independent of whether anything was inserted)
    // -----------------------------------------------------------------------
    const { data: deletedRows, error: deleteError } = await client
      .from('campaigns')
      .delete()
      .lt('date', pastCampaignStartStr)
      .select();
    if (deleteError) throw deleteError;
    const deletedCount = deletedRows?.length ?? 0;

    // -----------------------------------------------------------------------
    // Log success
    // -----------------------------------------------------------------------
    await client
      .from('weekly_refresh_log')
      .insert({
        completed_at:      new Date().toISOString(),
        created_by:        userId,
        triggered_by:      triggeredBy,
        campaigns_created: createdCount,
        campaigns_skipped: skippedCount,
        campaigns_deleted: deletedCount,
      })
      .then(({ error }) => {
        if (error) console.error('[weeklyRefresh] log insert error:', error);
      });

    return { created: createdCount, skipped: skippedCount, deleted: deletedCount, secondWeekStart };

  } catch (err) {
    // Log the failure (best-effort — don't let a log failure mask the original error)
    const message = err instanceof Error ? err.message : String(err);
    await client
      .from('weekly_refresh_log')
      .insert({
        completed_at:  new Date().toISOString(),
        created_by:    userId,
        triggered_by:  triggeredBy,
        error_message: message,
      })
      .then(({ error }) => {
        if (error) console.error('[weeklyRefresh] error-log insert failed:', error);
      });
    throw err;
  }
}
