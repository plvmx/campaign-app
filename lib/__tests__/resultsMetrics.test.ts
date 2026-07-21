import { describe, it, expect, vi } from 'vitest';
import { makeQueryBuilder } from '@/lib/services/__tests__/supabaseMock';
import {
  fetchResultsMetrics,
  aggregateByCategory,
  aggregateByState,
  aggregateByPerson,
  type CampaignResultsRow,
} from '../resultsMetrics';

function fakeSupabase(campaignsResult: { data: unknown; error: unknown }, resultsResult: { data: unknown; error: unknown }) {
  const from = vi.fn()
    .mockReturnValueOnce(makeQueryBuilder(campaignsResult))
    .mockReturnValueOnce(makeQueryBuilder(resultsResult));
  return { supabase: { from } as unknown as Parameters<typeof fetchResultsMetrics>[0], from };
}

describe('fetchResultsMetrics', () => {
  it('returns [] without querying results when no campaigns are found', async () => {
    const { supabase, from } = fakeSupabase({ data: [], error: null }, { data: [], error: null });
    const rows = await fetchResultsMetrics(supabase, '2026-01-01', '2026-01-07');
    expect(rows).toEqual([]);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('groups results by category per campaign, combines place+site, and drops IR rows', async () => {
    const campaigns = [
      { id: 'c1', date: '2026-01-05', state: 'NSW', place: 'Orange', site: '1', leader: 'Sam', actual_leader: null },
      { id: 'c2', date: '2026-01-06', state: 'QLD', place: 'Cairns', site: '', leader: 'Ana', actual_leader: 'Ana' },
    ];
    const results = [
      { campaign_id: 'c1', first_name: 'Alice', category_code: 'TM' },
      { campaign_id: 'c1', first_name: 'Bob', category_code: 'P' },
      { campaign_id: 'c1', first_name: 'Carl', category_code: 'IR' },
      { campaign_id: 'c2', first_name: 'Dana', category_code: 'SP' },
    ];
    const { supabase } = fakeSupabase({ data: campaigns, error: null }, { data: results, error: null });

    const rows = await fetchResultsMetrics(supabase, '2026-01-01', '2026-01-07');

    expect(rows).toEqual([
      {
        campaignId: 'c1', date: '2026-01-05', state: 'NSW', place: 'Orange 1',
        leader: 'Sam', actualLeader: null,
        names: { TM: ['Alice'], P: ['Bob'], F: [], SP: [] },
      },
      {
        campaignId: 'c2', date: '2026-01-06', state: 'QLD', place: 'Cairns',
        leader: 'Ana', actualLeader: 'Ana',
        names: { TM: [], P: [], F: [], SP: ['Dana'] },
      },
    ]);
  });

  it('includes campaigns with no recorded results', async () => {
    const campaigns = [{ id: 'c1', date: '2026-01-05', state: 'NSW', place: 'Orange', site: '', leader: 'Sam', actual_leader: null }];
    const { supabase } = fakeSupabase({ data: campaigns, error: null }, { data: [], error: null });

    const rows = await fetchResultsMetrics(supabase, '2026-01-01', '2026-01-07');
    expect(rows).toHaveLength(1);
    expect(rows[0].names).toEqual({ TM: [], P: [], F: [], SP: [] });
  });

  it('throws when the campaigns query errors', async () => {
    const error = { code: '500', message: 'boom' };
    const { supabase } = fakeSupabase({ data: null, error }, { data: [], error: null });
    await expect(fetchResultsMetrics(supabase, '2026-01-01', '2026-01-07')).rejects.toEqual(error);
  });

  it('throws when the results query errors', async () => {
    const campaigns = [{ id: 'c1', date: '2026-01-05', state: 'NSW', place: 'Orange', site: '', leader: 'Sam', actual_leader: null }];
    const error = { code: '500', message: 'boom' };
    const { supabase } = fakeSupabase({ data: campaigns, error: null }, { data: null, error });
    await expect(fetchResultsMetrics(supabase, '2026-01-01', '2026-01-07')).rejects.toEqual(error);
  });
});

// ---------------------------------------------------------------------------
// Aggregations
// ---------------------------------------------------------------------------

function row(overrides: Partial<CampaignResultsRow>): CampaignResultsRow {
  return {
    campaignId: 'c1', date: '2026-01-05', state: 'NSW', place: 'Orange',
    leader: 'Sam', actualLeader: null,
    names: { TM: [], P: [], F: [], SP: [] },
    ...overrides,
  };
}

describe('aggregateByCategory', () => {
  it('sums counts per category across all rows', () => {
    const rows = [
      row({ names: { TM: ['Alice', 'Bob'], P: ['Carl'], F: [], SP: [] } }),
      row({ names: { TM: ['Dana'], P: [], F: ['Eve'], SP: ['Frank'] } }),
    ];
    expect(aggregateByCategory(rows)).toEqual([
      { category: 'TM', count: 3 },
      { category: 'P', count: 1 },
      { category: 'F', count: 1 },
      { category: 'SP', count: 1 },
    ]);
  });
});

describe('aggregateByState', () => {
  it('totals campaigns and result counts per state, sorted by total descending', () => {
    const rows = [
      row({ state: 'NSW', names: { TM: ['Alice'], P: [], F: [], SP: [] } }),
      row({ state: 'QLD', names: { TM: ['Bob'], P: ['Carl'], F: ['Dana'], SP: [] } }),
      row({ state: 'NSW', names: { TM: [], P: [], F: [], SP: [] } }),
    ];
    const totals = aggregateByState(rows);
    expect(totals).toEqual([
      { state: 'QLD', campaigns: 1, totals: { TM: 1, P: 1, F: 1, SP: 0 }, total: 3 },
      { state: 'NSW', campaigns: 2, totals: { TM: 1, P: 0, F: 0, SP: 0 }, total: 1 },
    ]);
  });
});

describe('aggregateByPerson', () => {
  it('groups by trimmed, case-insensitive name and sums totals across categories', () => {
    const rows = [
      row({ names: { TM: ['Alice'], P: [], F: [], SP: [] } }),
      row({ names: { TM: [], P: ['alice '], F: [], SP: [] } }),
      row({ names: { TM: [], P: [], F: [], SP: ['Bob'] } }),
    ];
    const totals = aggregateByPerson(rows);
    expect(totals).toEqual([
      { name: 'Alice', totals: { TM: 1, P: 1, F: 0, SP: 0 }, total: 2 },
      { name: 'Bob', totals: { TM: 0, P: 0, F: 0, SP: 1 }, total: 1 },
    ]);
  });

  it('ignores blank names', () => {
    const rows = [row({ names: { TM: ['  '], P: [], F: [], SP: [] } })];
    expect(aggregateByPerson(rows)).toEqual([]);
  });
});
