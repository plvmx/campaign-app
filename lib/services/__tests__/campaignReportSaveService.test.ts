import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  EXPERIMENTAL_REPORT_SOURCE,
  REPORT_SOURCE,
  getSavedReportNames,
  loadReportCampaign,
  parseReportSubmission,
  saveCampaignReport,
} from '../campaignReportSaveService';
import { makeQueryBuilder, type MockQueryBuilder } from './supabaseMock';

const campaignRow = { date: '2026-10-31', state: 'VIC', place: 'Orange', site: '1', leader: 'Jane Smith', mobile: '0400123456' };
const counts = { partial: 1, full: 2, sinnersPrayers: 0, followUp: 1 };
const names = { partial: ['Ann'], full: ['Bob', 'Cy Lee'], sinnersPrayers: [], followUp: ['Di'] };
const valid = { campaignId: 'c1', ...counts, names };

describe('parseReportSubmission', () => {
  it('accepts counts with exactly that many valid names (trimmed)', () => {
    expect(parseReportSubmission({ ...valid, names: { ...names, partial: ['  Ann '] } })).toEqual({
      campaignId: 'c1',
      counts,
      names,
    });
  });

  it.each<[string, unknown]>([
    ['no body', null],
    ['no campaign id', { ...valid, campaignId: '' }],
    ['a count missing', { ...valid, followUp: undefined }],
    ['no names object', { ...valid, names: undefined }],
    ['a names list missing', { ...valid, names: { ...names, followUp: undefined } }],
    ['too few names for a count', { ...valid, names: { ...names, full: ['Bob'] } }],
    ['too many names for a count', { ...valid, names: { ...names, sinnersPrayers: ['Extra'] } }],
    ['a blank name', { ...valid, names: { ...names, partial: ['   '] } }],
    ['a name with digits', { ...valid, names: { ...names, partial: ['Ann9'] } }],
    ['a name with symbols', { ...valid, names: { ...names, partial: ['Ann-Marie'] } }],
    ['a name over 20 characters', { ...valid, names: { ...names, partial: ['A'.repeat(21)] } }],
    ['a non-string name', { ...valid, names: { ...names, partial: [5] } }],
  ])('rejects %s', (_label, body) => expect(parseReportSubmission(body)).toBeNull());
});

// state_places has no `site` column any more (site was folded into place), so rows never carry one.
const placeRows = [
  { place: 'Orange 1', location: 'Orange' },
  { place: 'Sylvania', location: null },
  { place: 'TestPlace', location: 'Ashburton ' },
];

type Method = 'insert' | 'delete' | 'select';
interface Call { table: string; builder: MockQueryBuilder }

/**
 * Each from() call gets its own builder, so the several calls the service makes to one table can return
 * different things: the earlier rows it will replace, the id of the row it inserts, and so on.
 */
function makeClient(opts: {
  places?: unknown;
  oldReports?: Array<{ id: string }>;
  oldResults?: Array<{ id: string }>;
  failInsertOn?: 'campaign_reports' | 'results';
  failDeleteOn?: 'campaign_reports' | 'results';
} = {}) {
  const calls: Call[] = [];
  const seen: Record<string, number> = {};
  const from = vi.fn((table: string) => {
    const n = (seen[table] = (seen[table] ?? 0) + 1);
    let result: { data: unknown; error: unknown } = { data: null, error: null };
    if (table === 'state_places') result = { data: opts.places === undefined ? placeRows : opts.places, error: null };
    if (table === 'campaign_reports') result = { data: n === 1 ? opts.oldReports ?? [] : { id: 'new-report' }, error: null };
    if (table === 'results' && n === 1) result = { data: opts.oldResults ?? [], error: null };
    const builder = makeQueryBuilder(result);
    // Make this table's insert (and, later, delete) fail when asked.
    if (opts.failInsertOn === table) builder.insert.mockImplementation(() => {
      const failing = makeQueryBuilder({ data: null, error: { message: 'boom' } });
      builder.select.mockReturnValue(failing); builder.single.mockResolvedValue({ data: null, error: { message: 'boom' } });
      Object.assign(builder, { then: failing.then });
      return builder;
    });
    calls.push({ table, builder });
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, calls };
}
const used = (calls: Call[], table: string, method: Method) =>
  calls.filter((c) => c.table === table && c.builder[method].mock.calls.length > 0);

describe('saveCampaignReport', () => {
  const input = { ...parseReportSubmission(valid)!, campaign: campaignRow, actorUserId: 'admin-1' };

  it('writes one report row tagged app_report, with the campaign\'s own location, leader and date', async () => {
    const { client, calls } = makeClient();
    await expect(saveCampaignReport(client, input)).resolves.toEqual({ status: 'saved', names: 4 });
    const row = used(calls, 'campaign_reports', 'insert')[0].builder.insert.mock.calls[0][0];
    expect(row).toMatchObject({
      campaign_id: 'c1',
      campaign_date: '2026-10-31',
      location_raw: 'Orange 1 VIC',
      leader_raw: 'Jane Smith',
      partial_presentations: 1,
      full_presentations: 2,
      sinners_prayer: 0,
      information_requests: 1,
      needs_review: false,
      source: REPORT_SOURCE,
    });
    expect(REPORT_SOURCE).toBe('app_report');
    expect(Number.isNaN(Date.parse(row.submitted_at))).toBe(false);
  });

  it('fills the derived state, location and leader from the campaign', async () => {
    const { client, calls } = makeClient();
    await saveCampaignReport(client, input);
    expect(used(calls, 'campaign_reports', 'insert')[0].builder.insert.mock.calls[0][0]).toMatchObject({
      derived_state: 'VIC',
      derived_location: 'Orange',
      derived_leader: 'Jane Smith',
    });
  });

  it('only asks state_places for columns that exist (place, location) — there is no site column', async () => {
    const { client, calls } = makeClient();
    await saveCampaignReport(client, input);
    const selected = calls.find((c) => c.table === 'state_places')!.builder.select.mock.calls[0][0] as string;
    expect(selected.split(',').map((c) => c.trim()).sort()).toEqual(['location', 'place']);
  });

  it('trims the location from State Places, falls back to the place name\'s row, and leaves it empty for an unknown place', async () => {
    const test = makeClient();
    await saveCampaignReport(test.client, { ...input, campaign: { ...campaignRow, place: 'TestPlace', site: '' } });
    expect(used(test.calls, 'campaign_reports', 'insert')[0].builder.insert.mock.calls[0][0].derived_location).toBe('Ashburton');

    const sylvania = makeClient();
    await saveCampaignReport(sylvania.client, { ...input, campaign: { ...campaignRow, place: 'Sylvania', site: '' } });
    expect(used(sylvania.calls, 'campaign_reports', 'insert')[0].builder.insert.mock.calls[0][0].derived_location).toBe('Sylvania');

    const unknown = makeClient({ places: [] });
    await saveCampaignReport(unknown.client, input);
    expect(used(unknown.calls, 'campaign_reports', 'insert')[0].builder.insert.mock.calls[0][0].derived_location).toBeNull();
  });

  it('writes every name to results under its category, tagged and attributed to the caller', async () => {
    const { client, calls } = makeClient();
    await saveCampaignReport(client, input);
    const rows = used(calls, 'results', 'insert')[0].builder.insert.mock.calls[0][0];
    const base = { campaign_id: 'c1', user_id: 'admin-1', source: REPORT_SOURCE };
    expect(rows).toEqual([
      { ...base, first_name: 'Ann', category_code: 'P' },
      { ...base, first_name: 'Bob', category_code: 'F' },
      { ...base, first_name: 'Cy Lee', category_code: 'F' },
      { ...base, first_name: 'Di', category_code: 'IR' },
    ]);
  });

  it('replaces an earlier save: looks up this campaign\'s earlier rows (any screen\'s names, this page\'s reports incl. test ones, never TM) and removes them by id', async () => {
    const { client, calls } = makeClient({ oldReports: [{ id: 'old-r1' }], oldResults: [{ id: 'old-n1' }, { id: 'old-n2' }] });
    await saveCampaignReport(client, input);

    const reportLookup = calls.find((c) => c.table === 'campaign_reports')!.builder;
    expect(reportLookup.eq).toHaveBeenCalledWith('campaign_id', 'c1');
    expect(reportLookup.in).toHaveBeenCalledWith('source', [REPORT_SOURCE, EXPERIMENTAL_REPORT_SOURCE]);

    const resultsLookup = calls.find((c) => c.table === 'results')!.builder;
    expect(resultsLookup.in).toHaveBeenCalledWith('category_code', ['P', 'F', 'SP', 'IR']);

    expect(used(calls, 'results', 'delete')[0].builder.in).toHaveBeenCalledWith('id', ['old-n1', 'old-n2']);
    expect(used(calls, 'campaign_reports', 'delete')[0].builder.in).toHaveBeenCalledWith('id', ['old-r1']);
  });

  it('writes the new rows BEFORE removing the old ones, so a failure can never lose what was saved', async () => {
    const { client, calls } = makeClient({ oldReports: [{ id: 'old-r1' }], oldResults: [{ id: 'old-n1' }] });
    await saveCampaignReport(client, input);
    const order = calls.map((c) => ['insert', 'delete'].find((m) => c.builder[m as Method].mock.calls.length > 0)).filter(Boolean);
    expect(order.indexOf('delete')).toBeGreaterThan(order.lastIndexOf('insert'));
  });

  it('removes nothing when there was nothing earlier, and skips the results insert when there are no names', async () => {
    const { client, calls } = makeClient();
    const none = { ...input, counts: { partial: 0, full: 0, sinnersPrayers: 0, followUp: 0 }, names: { partial: [], full: [], sinnersPrayers: [], followUp: [] } };
    await expect(saveCampaignReport(client, none)).resolves.toEqual({ status: 'saved', names: 0 });
    expect(used(calls, 'results', 'insert')).toHaveLength(0);
    expect(used(calls, 'results', 'delete')).toHaveLength(0);
    expect(used(calls, 'campaign_reports', 'delete')).toHaveLength(0);
  });

  it('throws, keeping the earlier rows, if the report row cannot be saved', async () => {
    const { client, calls } = makeClient({ oldReports: [{ id: 'old-r1' }], oldResults: [{ id: 'old-n1' }], failInsertOn: 'campaign_reports' });
    await expect(saveCampaignReport(client, input)).rejects.toThrow('Could not save the report');
    expect(used(calls, 'results', 'delete')).toHaveLength(0);
  });

  it('takes back the new report row and keeps the earlier rows if the names cannot be saved', async () => {
    const { client, calls } = makeClient({ oldReports: [{ id: 'old-r1' }], oldResults: [{ id: 'old-n1' }], failInsertOn: 'results' });
    await expect(saveCampaignReport(client, input)).rejects.toThrow('Could not save the names');
    const deletes = used(calls, 'campaign_reports', 'delete');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].builder.eq).toHaveBeenCalledWith('id', 'new-report');
    expect(used(calls, 'results', 'delete')).toHaveLength(0);
  });
});

describe('loadReportCampaign', () => {
  it('returns the campaign row, or null when there is none', async () => {
    const found = vi.fn(() => makeQueryBuilder({ data: campaignRow, error: null }));
    await expect(loadReportCampaign({ from: found } as unknown as SupabaseClient, 'c1')).resolves.toEqual(campaignRow);
    const none = vi.fn(() => makeQueryBuilder({ data: null, error: null }));
    await expect(loadReportCampaign({ from: none } as unknown as SupabaseClient, 'c1')).resolves.toBeNull();
  });
});

describe('getSavedReportNames', () => {
  it('groups the campaign\'s saved names by count field, whichever screen wrote them, ignoring other categories', async () => {
    const builder = makeQueryBuilder({
      data: [
        { first_name: 'Ann', category_code: 'P' },
        { first_name: 'Bob', category_code: 'F' },
        { first_name: 'Cy', category_code: 'SP' },
        { first_name: 'Di', category_code: 'IR' },
        { first_name: 'Ed', category_code: 'F' },
        { first_name: 'Teammate', category_code: 'TM' },
      ],
      error: null,
    });
    const client = { from: vi.fn(() => builder) } as unknown as SupabaseClient;
    await expect(getSavedReportNames(client, 'c1')).resolves.toEqual({
      partial: ['Ann'], full: ['Bob', 'Ed'], sinnersPrayers: ['Cy'], followUp: ['Di'],
    });
    expect(builder.in).toHaveBeenCalledWith('category_code', ['P', 'F', 'SP', 'IR']);
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: true });
  });
});
