import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { calculateCampaignDates, formatDateForDb } from '@/lib/campaignDates';
import { makeQueryBuilder, type MockQueryBuilder } from './supabaseMock';
import { runWeeklyRefresh } from '../weeklyRefreshService';
import type { CampaignRule } from '@/lib/types';

type TableResponse = { data: unknown; error: unknown };

/**
 * A routing fake for the multi-table SupabaseClient this service depends on.
 * Each table gets its own queue of canned responses, consumed in call order —
 * this mirrors the service's real call sequence per table (e.g. 'campaigns' is
 * queried for existing rows, then optionally a biweekly lookback, then an
 * insert, then a delete — each needs a different canned result).
 */
function makeClient(responses: Partial<Record<string, TableResponse[]>>) {
  const counters: Record<string, number> = {};
  const builders: Record<string, MockQueryBuilder[]> = {};
  const from = vi.fn((table: string) => {
    const queue = responses[table] ?? [];
    const idx = counters[table] ?? 0;
    counters[table] = idx + 1;
    const result = queue[idx] ?? { data: null, error: null };
    const builder = makeQueryBuilder(result);
    (builders[table] ??= []).push(builder);
    return builder;
  });
  const client = { from } as unknown as SupabaseClient;
  return { client, builders };
}

// Rules default to already having had their one-off catch-up evaluation (mirrors every
// rule that predates the migration, and any rule old enough to be a normal fixture here) —
// tests about catch-up itself override this back to `null` to make a rule eligible.
const ALREADY_CAUGHT_UP = '2020-01-01T00:00:00.000Z';

function makeRule(overrides: Partial<CampaignRule> = {}): CampaignRule {
  return {
    id: 'rule-1', name: 'Test Rule', leader: 'Alice', state: 'VIC', place: 'Melbourne', site: '', time: '10:00',
    mobile: null, frequency_type: 'weekly', frequency_value: null, month_week_number: null,
    month_day_of_week: null, day_of_week: 1 /* Monday — always matches secondWeekStart */,
    start_date: null, end_date: null, is_active: true, priority: 0, rule_config: {}, notes: null,
    catchup_evaluated_at: ALREADY_CAUGHT_UP,
    ...overrides,
  };
}

// secondWeekStart/upcomingCampaignStart are always Mondays, computed relative to whatever
// "today" is — deriving them live (rather than hardcoding a date) keeps these tests stable
// over time.
const { upcomingCampaignStart, secondWeekStart } = calculateCampaignDates();
const secondWeekStartStr = formatDateForDb(secondWeekStart);
const upcomingCampaignStartStr = formatDateForDb(upcomingCampaignStart);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runWeeklyRefresh', () => {
  it('does nothing (0/0/0/0) when there are no active rules and nothing to prune', async () => {
    const { client } = makeClient({
      state_leaders: [{ data: [{ state: 'VIC' }], error: null }],
      campaign_rules: [{ data: [], error: null }],
      campaigns: [
        { data: [], error: null }, // existing rows in target week
        { data: [], error: null }, // delete old campaigns
      ],
      campaign_changes_log: [{ data: [], error: null }],
      weekly_refresh_log: [{ data: null, error: null }],
    });

    const result = await runWeeklyRefresh(client, 'user-1');

    expect(result).toEqual({
      created: 0, skipped: 0, deleted: 0, logsPruned: 0, secondWeekStart,
    });
  });

  it('creates a campaign from an active weekly rule matching the target week', async () => {
    const rule = makeRule();
    const { client, builders } = makeClient({
      state_leaders: [{ data: [{ state: 'VIC' }], error: null }],
      campaign_rules: [{ data: [rule], error: null }],
      campaigns: [
        { data: [], error: null },   // existing rows in target week
        { data: null, error: null }, // insert
        { data: [], error: null },   // delete old
      ],
      campaign_changes_log: [{ data: [], error: null }],
      weekly_refresh_log: [{ data: null, error: null }],
    });

    const result = await runWeeklyRefresh(client, 'user-1');

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    const insertBuilder = builders.campaigns[1];
    expect(insertBuilder.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        date: secondWeekStartStr, state: 'VIC', place: 'Melbourne', site: '', time: '10:00',
        leader: 'Alice', category: 'TWOL', user_id: 'user-1', source: 'RUL', tl_ok: false,
      }),
    ]);
  });

  it('skips a rule-generated campaign that already exists at that exact slot', async () => {
    const rule = makeRule();
    const { client, builders } = makeClient({
      state_leaders: [{ data: [{ state: 'VIC' }], error: null }],
      campaign_rules: [{ data: [rule], error: null }],
      campaigns: [
        { data: [{ date: secondWeekStartStr, state: 'VIC', place: 'Melbourne', site: '', time: '10:00', leader: 'Alice' }], error: null },
        { data: [], error: null }, // delete old (no insert call in between — nothing to insert)
      ],
      campaign_changes_log: [{ data: [], error: null }],
      weekly_refresh_log: [{ data: null, error: null }],
    });

    const result = await runWeeklyRefresh(client, 'user-1');

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(builders.campaigns).toHaveLength(2); // existing-rows select + delete — no insert call
  });

  it('does not treat a different site at the same place/time/leader as an existing match', async () => {
    // Regression: site must be part of the dedup slot key. A rule for "Orange 1" must not
    // be skipped just because "Orange" (no site) already has a campaign at that date/time/leader.
    const rule = makeRule({ place: 'Orange', site: '1' });
    const { client, builders } = makeClient({
      state_leaders: [{ data: [{ state: 'VIC' }], error: null }],
      campaign_rules: [{ data: [rule], error: null }],
      campaigns: [
        {
          data: [
            { date: secondWeekStartStr, state: 'VIC', place: 'Orange', site: '', time: '10:00', leader: 'Alice' },
          ],
          error: null,
        },
        { data: null, error: null }, // insert
        { data: [], error: null },   // delete old
      ],
      campaign_changes_log: [{ data: [], error: null }],
      weekly_refresh_log: [{ data: null, error: null }],
    });

    const result = await runWeeklyRefresh(client, 'user-1');

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    const insertBuilder = builders.campaigns[1];
    expect(insertBuilder.insert).toHaveBeenCalledWith([
      expect.objectContaining({ place: 'Orange', site: '1' }),
    ]);
  });

  it('catches up a newly-created monthly rule whose only occurrence this month falls in the current week', async () => {
    // Regression for the "Hornsby 3rd Saturday" incident: a rule created after the one
    // secondWeek-window run that would have covered its imminent first occurrence could
    // never generate that campaign — secondWeekStart only ever advances forward, and the
    // normal pass never looks at the current week. Construct a monthly rule whose single
    // occurrence this month is upcomingCampaignStart itself (always a Monday), bounded by
    // end_date so it can't coincidentally also land inside the normal secondWeek window.
    const monthWeekNumber = Math.ceil(upcomingCampaignStart.getDate() / 7);
    const monthEnd = new Date(upcomingCampaignStart.getFullYear(), upcomingCampaignStart.getMonth() + 1, 0);
    const rule = makeRule({
      frequency_type: 'monthly', month_week_number: monthWeekNumber, month_day_of_week: 1 /* Monday */,
      day_of_week: null, end_date: formatDateForDb(monthEnd),
      catchup_evaluated_at: null, // not yet evaluated — eligible for its one-off catch-up pass
    });
    const { client, builders } = makeClient({
      state_leaders: [{ data: [{ state: 'VIC' }], error: null }],
      campaign_rules: [
        { data: [rule], error: null },   // initial active-rules select
        { data: null, error: null },     // catch-up mark update, after insert succeeds
      ],
      campaigns: [
        { data: [], error: null },   // no existing campaigns
        { data: null, error: null }, // insert
        { data: [], error: null },   // delete old
      ],
      campaign_changes_log: [{ data: [], error: null }],
      weekly_refresh_log: [{ data: null, error: null }],
    });

    const result = await runWeeklyRefresh(client, 'user-1');

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    const insertBuilder = builders.campaigns[1];
    expect(insertBuilder.insert).toHaveBeenCalledWith([
      expect.objectContaining({ date: upcomingCampaignStartStr, state: 'VIC', place: 'Melbourne', leader: 'Alice' }),
    ]);

    // The rule gets flipped so it's never picked up by catch-up again.
    const markCaughtUpBuilder = builders.campaign_rules[1];
    expect(markCaughtUpBuilder.update).toHaveBeenCalledWith({
      catchup_evaluated_at: expect.any(String),
    });
    expect(markCaughtUpBuilder.in).toHaveBeenCalledWith('id', ['rule-1']);
  });

  it('does not catch up a rule that has already had its one-off catch-up evaluation', async () => {
    // Same imminent-occurrence shape as the test above, but `catchup_evaluated_at` is
    // already set (e.g. from a prior successful run) — catch-up must not fire again for
    // it, regardless of what the campaigns table currently looks like for that slot.
    const monthWeekNumber = Math.ceil(upcomingCampaignStart.getDate() / 7);
    const monthEnd = new Date(upcomingCampaignStart.getFullYear(), upcomingCampaignStart.getMonth() + 1, 0);
    const rule = makeRule({
      frequency_type: 'monthly', month_week_number: monthWeekNumber, month_day_of_week: 1 /* Monday */,
      day_of_week: null, end_date: formatDateForDb(monthEnd),
    });
    const { client, builders } = makeClient({
      state_leaders: [{ data: [{ state: 'VIC' }], error: null }],
      campaign_rules: [{ data: [rule], error: null }],
      campaigns: [
        { data: [], error: null }, // existing rows in target week
        { data: [], error: null }, // delete old — no insert call, nothing new to create
      ],
      campaign_changes_log: [{ data: [], error: null }],
      weekly_refresh_log: [{ data: null, error: null }],
    });

    const result = await runWeeklyRefresh(client, 'user-1');

    expect(result.created).toBe(0);
    // No catch-up mark update either — campaign_rules was only queried once.
    expect(builders.campaign_rules).toHaveLength(1);
  });

  it('backfills a biweekly rule\'s missing reference_date and updates it after a new campaign is created', async () => {
    const rule = makeRule({
      id: 'rule-2', leader: 'Bob', frequency_type: 'biweekly', frequency_value: 2, rule_config: {},
    });
    const { client, builders } = makeClient({
      state_leaders: [{ data: [{ state: 'VIC' }], error: null }],
      campaign_rules: [
        { data: [rule], error: null },   // initial active-rules select
        { data: null, error: null },     // reference_date update after insert
      ],
      campaigns: [
        { data: [], error: null },                                   // no existing campaigns
        { data: [{ date: secondWeekStartStr }], error: null },       // biweekly lookback — most recent campaign
        { data: null, error: null },                                 // insert
        { data: [], error: null },                                   // delete old
      ],
      campaign_changes_log: [{ data: [], error: null }],
      weekly_refresh_log: [{ data: null, error: null }],
    });

    const result = await runWeeklyRefresh(client, 'user-1');

    expect(result.created).toBe(1);
    const lookbackBuilder = builders.campaigns[1];
    expect(lookbackBuilder.eq).toHaveBeenCalledWith('state', 'VIC');
    expect(lookbackBuilder.eq).toHaveBeenCalledWith('place', 'Melbourne');
    expect(lookbackBuilder.eq).toHaveBeenCalledWith('site', '');
    expect(lookbackBuilder.eq).toHaveBeenCalledWith('time', '10:00');
    expect(lookbackBuilder.eq).toHaveBeenCalledWith('leader', 'Bob');

    const updateBuilder = builders.campaign_rules[1];
    expect(updateBuilder.update).toHaveBeenCalledWith({
      rule_config: { reference_date: secondWeekStartStr },
    });
    expect(updateBuilder.eq).toHaveBeenCalledWith('id', 'rule-2');
  });

  it('propagates the real error and logs the failure, rather than swallowing it', async () => {
    const { client, builders } = makeClient({
      state_leaders: [{ data: null, error: { message: 'db down' } }],
      weekly_refresh_log: [{ data: null, error: null }],
    });

    await expect(runWeeklyRefresh(client, 'user-1')).rejects.toThrow('db down');

    const logBuilder = builders.weekly_refresh_log[0];
    expect(logBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ triggered_by: 'manual', created_by: 'user-1', error_message: 'db down' }),
    );
  });

  it('tolerates a log-pruning failure — refresh still completes, logsPruned defaults to 0', async () => {
    const { client } = makeClient({
      state_leaders: [{ data: [{ state: 'VIC' }], error: null }],
      campaign_rules: [{ data: [], error: null }],
      campaigns: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      campaign_changes_log: [{ data: null, error: { message: 'prune failed' } }],
      weekly_refresh_log: [{ data: null, error: null }],
    });

    const result = await runWeeklyRefresh(client, 'user-1');
    expect(result.logsPruned).toBe(0);
    expect(result.created).toBe(0);
  });

  it('marks the run as automatic (triggered_by "auto") when userId is null', async () => {
    const { client, builders } = makeClient({
      state_leaders: [{ data: [{ state: 'VIC' }], error: null }],
      campaign_rules: [{ data: [], error: null }],
      campaigns: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      campaign_changes_log: [{ data: [], error: null }],
      weekly_refresh_log: [{ data: null, error: null }],
    });

    await runWeeklyRefresh(client, null);

    const logBuilder = builders.weekly_refresh_log[0];
    expect(logBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ triggered_by: 'auto', created_by: null }),
    );
  });
});
