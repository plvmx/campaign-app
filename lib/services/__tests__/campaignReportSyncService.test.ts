import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeQueryBuilder } from './supabaseMock';
import { prepareInserts, syncCampaignReportsFromSheet, SHEET_SYNC_SOURCE } from '../campaignReportSyncService';
import type { RawCampaignReportSheetRow } from '@/lib/campaignReportParser';

const HEADER = 'Date,Location,Campaign Leader,Dates,Partial Presentations,Full Presentations,Sinners Prayer ,Information Requests';

function raw(overrides: Partial<RawCampaignReportSheetRow> = {}): RawCampaignReportSheetRow {
  return {
    submittedAt: new Date('2026-10-01T01:00:00Z'), location: 'Dandenong', leader: 'Brent',
    campaignDate: '1/10/26', partialPresentations: 1, fullPresentations: 2, sinnersPrayer: 0, informationRequests: 0,
    ...overrides,
  };
}

describe('prepareInserts', () => {
  it('skips rows without a timestamp, keeps the first of a repeated timestamp, and tags the source', () => {
    const { inserts, skippedNoTimestamp, duplicateTimestamps } = prepareInserts([
      raw(), raw({ location: 'second' }), raw({ submittedAt: null }), raw({ submittedAt: new Date('2026-10-02T01:00:00Z') }),
    ]);
    expect(inserts).toHaveLength(2);
    expect(inserts[0].location_raw).toBe('Dandenong');
    expect(inserts.every((r) => r.source === SHEET_SYNC_SOURCE)).toBe(true);
    expect(skippedNoTimestamp).toBe(1);
    expect(duplicateTimestamps).toBe(1);
  });
});

describe('syncCampaignReportsFromSheet', () => {
  const csv = `${HEADER}\n2026-10-01 12:00:00,Dandenong,Brent,1/10/26,1,2,0,0\n`;
  const gviz = `x(${JSON.stringify({ status: 'ok', table: { rows: [{ c: [
    { v: 'Date(2026,9,1,12,0,0)', f: '2026-10-01 12:00:00' }, null, null, { v: 'Date(2026,9,1)' }, { v: 1 }, { v: 2 }, { v: 0 }, { v: 0 }] }] } })});`;
  const fetchImpl = (async (url: string) => ({ ok: true, status: 200, text: async () => (url.includes('gviz') ? gviz : csv) })) as unknown as typeof fetch;

  function makeClient() {
    const upsert = makeQueryBuilder({ data: [{ id: 'new' }], error: null });
    const reports = makeQueryBuilder({ data: [], error: null });
    const places = makeQueryBuilder({ data: [{ state: 'VIC', place: 'Dandenong' }], error: null });
    const leaders = makeQueryBuilder({ data: [], error: null });
    const from = vi.fn((table: string) => {
      if (table === 'state_places') return places;
      if (table === 'state_leaders') return leaders;
      return reports;
    });
    reports.upsert = vi.fn().mockReturnValue(upsert);
    return { client: { from } as unknown as SupabaseClient, reports };
  }

  it('upserts new rows ignoring duplicates on submitted_at, so existing rows are never modified', async () => {
    const { client, reports } = makeClient();
    const result = await syncCampaignReportsFromSheet(client, 'sheet', { fetchImpl });
    expect(reports.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ location_raw: 'Dandenong', source: SHEET_SYNC_SOURCE, submitted_at: '2026-10-01T02:00:00.000Z' })],
      { onConflict: 'submitted_at', ignoreDuplicates: true },
    );
    expect(result).toMatchObject({ sheetRows: 1, inserted: 1, alreadyPresent: 0 });
  });

  it('writes nothing on a dry run', async () => {
    const { client, reports } = makeClient();
    const result = await syncCampaignReportsFromSheet(client, 'sheet', { fetchImpl, apply: false });
    expect(reports.upsert).not.toHaveBeenCalled();
    expect(result.inserted).toBe(1);
  });
});
