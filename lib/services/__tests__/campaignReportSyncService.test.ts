import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeQueryBuilder } from './supabaseMock';
import {
  prepareInserts, syncCampaignReportsFromSheet, deriveCampaignReportFieldsSince, summarizeUnresolvedLocations, SHEET_SYNC_SOURCE,
} from '../campaignReportSyncService';
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

describe('deriveCampaignReportFieldsSince', () => {
  function setup(rows: unknown[], aliasError: unknown = null) {
    const reports = makeQueryBuilder({ data: rows, error: null });
    const tables: Record<string, ReturnType<typeof makeQueryBuilder>> = {
      campaign_reports: reports,
      state_places: makeQueryBuilder({ data: [{ state: 'VIC', place: 'Dandenong' }], error: null }),
      state_leaders: makeQueryBuilder({ data: [{ state: 'VIC', leader: 'Brent' }], error: null }),
      campaign_report_location_aliases: makeQueryBuilder({ data: aliasError ? null : [{ location_key: 'herberton', state: 'QLD', place: 'Herberton' }], error: aliasError }),
    };
    return { client: { from: vi.fn((t: string) => tables[t]) } as unknown as SupabaseClient, reports };
  }
  const row = (o: object) => ({ id: 'r', location_raw: 'Dandenong', leader_raw: 'Brent', derived_state: null, derived_place: null, derived_leader: null, ...o });

  it('fills only empty fields, so a hand-entered value is never overwritten', async () => {
    const { client, reports } = setup([row({ id: 'a', derived_place: 'Hand Entered' })]);
    await deriveCampaignReportFieldsSince(client, '2000-01-01');
    expect(reports.update).toHaveBeenCalledWith({ derived_state: 'VIC', derived_place: 'Hand Entered', derived_leader: 'Brent' });
  });

  it('recomputes existing values when asked to overwrite', async () => {
    const { client, reports } = setup([row({ id: 'a', derived_place: 'Hand Entered' })]);
    await deriveCampaignReportFieldsSince(client, '2000-01-01', true, true);
    expect(reports.update).toHaveBeenCalledWith({ derived_state: 'VIC', derived_place: 'Dandenong', derived_leader: 'Brent' });
  });

  it('writes rows with identical values together and nothing on a dry run', async () => {
    const { client, reports } = setup([row({ id: 'a' }), row({ id: 'b' })]);
    const dry = await deriveCampaignReportFieldsSince(client, '2000-01-01', false);
    expect(dry.updated).toBe(2);
    expect(reports.update).not.toHaveBeenCalled();
    await deriveCampaignReportFieldsSince(client, '2000-01-01');
    expect(reports.update).toHaveBeenCalledTimes(1);
    expect(reports.in).toHaveBeenCalledWith('id', ['a', 'b']);
  });

  it('applies confirmed aliases and counts rows that still have no place', async () => {
    const { client } = setup([row({ id: 'a', location_raw: 'Herberton' }), row({ id: 'b', location_raw: 'Mystery' })]);
    const r = await deriveCampaignReportFieldsSince(client, '2000-01-01', false);
    expect(r).toMatchObject({ inScope: 2, noPlaceRows: 1, noPlaceLocations: 1, unresolved: 0 });
  });

  it('treats a not-yet-created aliases table as having no aliases', async () => {
    const { client } = setup([row({ id: 'a' })], { code: '42P01' });
    await expect(deriveCampaignReportFieldsSince(client, '2000-01-01', false)).resolves.toMatchObject({ inScope: 1 });
  });
});

describe('summarizeUnresolvedLocations', () => {
  it('is a single line either way', () => {
    expect(summarizeUnresolvedLocations({ inScope: 5, updated: 0, unresolved: 0, noPlaceRows: 0, noPlaceLocations: 0 })).toMatch(/^All campaign report locations map/);
    expect(summarizeUnresolvedLocations({ inScope: 5, updated: 0, unresolved: 0, noPlaceRows: 7, noPlaceLocations: 3 })).toMatch(/^3 location\(s\) \(7 report row\(s\)\)/);
  });
});
