import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeQueryBuilder } from '../services/__tests__/supabaseMock';
import { fetchReportRows, chunkReportRows, type ReportRow } from '../reportGenerator';

// fetchReportRows takes the Supabase client as an option, so it can be faked
// directly rather than mocking the '@/lib/supabaseClient' module.
function makeFakeSupabase(...results: { data: unknown; error: unknown }[]): SupabaseClient {
  const mockFrom = vi.fn();
  results.forEach((result) => mockFrom.mockReturnValueOnce(makeQueryBuilder(result)));
  return { from: mockFrom } as unknown as SupabaseClient;
}

describe('chunkReportRows', () => {
  const row = (n: number): ReportRow => ({
    dateLocation: `${n}/1 Place NSW`,
    state: 'NSW',
    fpAndSp: [],
    fpOnly: [],
    pp: [],
  });

  it('returns an empty array for no rows', () => {
    expect(chunkReportRows([])).toEqual([]);
  });

  it('groups rows into pages of 12', () => {
    const rows = Array.from({ length: 25 }, (_, i) => row(i));
    const pages = chunkReportRows(rows);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toHaveLength(12);
    expect(pages[1]).toHaveLength(12);
    expect(pages[2]).toHaveLength(1);
  });

  it('keeps a single page when rows fit within one JPEG', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(i));
    expect(chunkReportRows(rows)).toEqual([rows]);
  });
});

describe('fetchReportRows', () => {
  const campaigns = [
    { id: 'c1', date: '2026-08-10', state: 'NSW', place: 'Parramatta' },
    { id: 'c2', date: '2026-08-11', state: 'VIC', place: 'Frankston' },
  ];

  it('groups results by category into fpAndSp/fpOnly/pp and drops campaigns with no recorded results', async () => {
    const results = [
      { campaign_id: 'c1', first_name: 'Linda', category_code: 'SP', created_at: '2026-08-10T01:00:00Z' },
      { campaign_id: 'c1', first_name: 'Sam', category_code: 'F', created_at: '2026-08-10T02:00:00Z' },
      { campaign_id: 'c1', first_name: 'Ash', category_code: 'P', created_at: '2026-08-10T03:00:00Z' },
    ];
    const supabase = makeFakeSupabase(
      { data: campaigns, error: null },
      { data: results, error: null },
    );

    const rows = await fetchReportRows({ supabase, startDate: '2026-08-10', endDate: '2026-08-16' });

    // c2 had no results recorded, so it's filtered out of the report.
    expect(rows).toEqual([
      { dateLocation: '10/8 Parramatta NSW', state: 'NSW', fpAndSp: ['Linda'], fpOnly: ['Sam'], pp: ['Ash'] },
    ]);
  });

  it('filters to the SR role state when no explicit stateFilter is given', async () => {
    const supabase = makeFakeSupabase(
      { data: [campaigns[1]], error: null },
      { data: [{ campaign_id: 'c2', first_name: 'Jo', category_code: 'P', created_at: '2026-08-11T01:00:00Z' }], error: null },
    );

    const rows = await fetchReportRows({
      supabase,
      startDate: '2026-08-10',
      endDate: '2026-08-16',
      adminStatus: 'SR',
      userState: 'vic',
    });

    const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;
    const campaignsBuilder = mockFrom.mock.results[0].value;
    expect(campaignsBuilder.eq).toHaveBeenCalledWith('state', 'VIC');
    expect(rows).toEqual([
      { dateLocation: '11/8 Frankston VIC', state: 'VIC', fpAndSp: [], fpOnly: [], pp: ['Jo'] },
    ]);
  });

  it('lets an explicit stateFilter override the SR role state', async () => {
    const supabase = makeFakeSupabase(
      { data: campaigns, error: null },
      { data: [], error: null },
    );

    await fetchReportRows({
      supabase,
      startDate: '2026-08-10',
      endDate: '2026-08-16',
      adminStatus: 'SR',
      userState: 'vic',
      stateFilter: 'nsw',
    }).catch(() => {}); // no results recorded → throws; only the query args matter here

    const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;
    const campaignsBuilder = mockFrom.mock.results[0].value;
    expect(campaignsBuilder.eq).toHaveBeenCalledWith('state', 'NSW');
  });

  it('throws when no campaigns are found in range', async () => {
    const supabase = makeFakeSupabase({ data: [], error: null });
    await expect(
      fetchReportRows({ supabase, startDate: '2026-08-10', endDate: '2026-08-16' }),
    ).rejects.toThrow('No campaigns found in the selected date range.');
  });

  it('throws when campaigns exist but none have recorded results', async () => {
    const supabase = makeFakeSupabase(
      { data: campaigns, error: null },
      { data: [], error: null },
    );
    await expect(
      fetchReportRows({ supabase, startDate: '2026-08-10', endDate: '2026-08-16' }),
    ).rejects.toThrow('No results recorded for the selected date range.');
  });

  it('propagates a campaigns query error', async () => {
    const error = { code: '500', message: 'boom' };
    const supabase = makeFakeSupabase({ data: null, error });
    await expect(
      fetchReportRows({ supabase, startDate: '2026-08-10', endDate: '2026-08-16' }),
    ).rejects.toEqual(error);
  });
});
