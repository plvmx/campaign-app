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
import type { CampaignRule } from '@/lib/types';
import { evaluateRules } from '@/lib/campaignRules';
import { getErrorMessage } from '@/lib/errorUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NewCampaignRow {
  date: string;
  state: string;
  place: string;
  site: string;
  time: string;
  leader: string;
  mobile: string | null;
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
  /** Audit log rows pruned (older than LOG_RETENTION_DAYS). */
  logsPruned: number;
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
 *  1. Evaluate active campaign rules for the second upcoming week, plus a one-off
 *     "catch-up" pass into the current week for any rule with no campaign already
 *     on the books (see below).
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
  const { upcomingCampaignStart, secondWeekStart, pastCampaignStart } = calculateCampaignDates();

  const secondWeekEnd = new Date(secondWeekStart);
  secondWeekEnd.setDate(secondWeekEnd.getDate() + 6); // Mon – Sun

  // Catch-up window: the current week, up to (but not overlapping) secondWeekStart.
  // A rule normally gets exactly one shot at each week — evaluated once, when that
  // week is the "second week" (1-2 weeks out). A rule created *after* that shot for
  // the current week has already passed can never be revisited by the normal pass,
  // since secondWeekStart only advances forward. This window gives such rules one
  // catch-up evaluation into the current week.
  const catchUpEnd = new Date(secondWeekStart);
  catchUpEnd.setDate(catchUpEnd.getDate() - 1); // Sunday before secondWeekStart

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
      .select('date, state, place, site, time, leader')
      .gte('date', pastCampaignStartStr)
      .lte('date', secondWeekEndStr);
    if (existingError) throw existingError;

    const existingSlotKeys = new Set(
      (existingRows || []).map(
        (c: { date: string; state: string; place: string; site: string; time: string; leader: string }) =>
          `${c.date}_${c.state}_${c.place}_${c.site}_${c.time}_${c.leader}`
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
          .eq('site', rule.site)
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

    const toNewCampaignRow = (campaign: ReturnType<typeof evaluateRules>[number]): NewCampaignRow => ({
      date:      campaign.date,
      state:     campaign.state,
      place:     campaign.place,
      site:      campaign.site,
      time:      campaign.time,
      leader:    campaign.leader,
      mobile:    campaign.mobile,
      category:  campaign.category ?? 'TWOL',
      user_id:   userId,
      team_size: null as null,
      tl_ok:     false,
      source:    'RUL',
    });

    // Rules that get a catch-up evaluation this run — collected so they can be marked
    // as caught-up (see below) once the run's insert has actually succeeded.
    const rulesToMarkCaughtUp: CampaignRule[] = [];

    for (const state of states) {
      const stateRules = allRules.filter((r) => r.state === state);
      const ruleCampaigns = evaluateRules(stateRules, secondWeekStart, secondWeekEnd);
      allNewCampaigns.push(...ruleCampaigns.map(toNewCampaignRow));
      rulesUsedInRefresh.push(...stateRules);

      // Catch-up: a rule gets exactly one extra evaluation pass into the current week (a
      // range the normal pass above never covers), so a rule created after its first
      // occurrence's normal window has already gone by still gets that occurrence
      // generated. Eligibility is tracked with `catchup_evaluated_at` on the rule itself
      // (null = not yet evaluated) rather than by looking for a matching campaign row —
      // matching on campaign fields like `time` breaks the moment a rule's schedule is
      // edited after its first occurrence was generated (see #91), since already-generated
      // occurrences correctly keep their original values.
      const catchUpRules = stateRules.filter((r) => !r.catchup_evaluated_at);
      if (catchUpRules.length > 0) {
        const catchUpCampaigns = evaluateRules(catchUpRules, upcomingCampaignStart, catchUpEnd);
        allNewCampaigns.push(...catchUpCampaigns.map(toNewCampaignRow));
        rulesToMarkCaughtUp.push(...catchUpRules);
      }
    }

    // -----------------------------------------------------------------------
    // Deduplicate and insert
    // -----------------------------------------------------------------------
    const slotKey = (c: { date: string; state: string; place: string; site: string; time: string; leader: string }) =>
      `${c.date}_${c.state}_${c.place}_${c.site}_${c.time}_${c.leader}`;

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
              c.site   === rule.site   &&
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
    // Mark catch-up-eligible rules as evaluated — placed after the insert above has
    // succeeded (or been skipped because there was nothing to insert) so a rule is never
    // marked "caught up" without its campaign actually landing. This is a one-off flip:
    // once set, the rule never gets a catch-up pass again, regardless of what happens to
    // the resulting campaign afterward (edited, deleted, etc.) — its future occurrences
    // are reliably covered by the normal secondWeek pass from here on.
    // -----------------------------------------------------------------------
    if (rulesToMarkCaughtUp.length > 0) {
      const { error: catchupMarkError } = await client
        .from('campaign_rules')
        .update({ catchup_evaluated_at: new Date().toISOString() })
        .in('id', rulesToMarkCaughtUp.map((r) => r.id));
      if (catchupMarkError) throw catchupMarkError;
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
    // Prune audit log — rolling 90-day retention
    // -----------------------------------------------------------------------
    const LOG_RETENTION_DAYS = 90;
    const logCutoff = new Date();
    logCutoff.setDate(logCutoff.getDate() - LOG_RETENTION_DAYS);
    const { data: deletedLogs, error: logsDeleteError } = await client
      .from('campaign_changes_log')
      .delete()
      .lt('created_at', logCutoff.toISOString())
      .select('id');
    if (logsDeleteError) {
      // Non-fatal: log the error but don't fail the whole refresh
      console.error('[weeklyRefresh] log pruning error:', logsDeleteError);
    }
    const logsPrunedCount = deletedLogs?.length ?? 0;

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

    return { created: createdCount, skipped: skippedCount, deleted: deletedCount, logsPruned: logsPrunedCount, secondWeekStart };

  } catch (err) {
    // Log the failure (best-effort — don't let a log failure mask the original error).
    // Supabase errors are plain objects, not Error instances (see #69) — getErrorMessage
    // extracts message/code/details/hint instead of falling back to a useless string.
    const message = getErrorMessage(err);
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
