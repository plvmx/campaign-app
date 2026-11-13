import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  EXPERIMENTAL_REPORT_SOURCE,
  parseReportSubmission,
  saveCampaignReport,
} from '../campaignReportSaveService';
import { makeQueryBuilder, type MockQueryBuilder } from './supabaseMock';

const campaignRow = { date: '2026-10-31', state: 'VIC', place: 'Orange', site: '1', leader: 'Jane Smith' };
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

function makeClient(opts: { campaign?: unknown; failTable?: string; places?: unknown } = {}) {
  const builders: Array<{ table: string; builder: MockQueryBuilder }> = [];
  const from = vi.fn((table: string) => {
    const result =
      table === 'campaigns'
        ? { data: opts.campaign === undefined ? campaignRow : opts.campaign, error: null }
        : table === 'state_places'
          ? { data: opts.places === undefined ? placeRows : opts.places, error: null }
          : { data: null, error: null };
    const builder = makeQueryBuilder(result);
    // Fail only the insert (not the clean-up delete) for the chosen table.
    if (opts.failTable === table) builder.insert.mockResolvedValue({ data: null, error: { message: 'boom' } });
    builders.push({ table, builder });
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, builders };
}
const calls = (b: ReturnType<typeof makeClient>['builders'], table: string, method: 'insert' | 'delete') =>
  b.filter((x) => x.table === table && x.builder[method].mock.calls.length > 0);

describe('saveCampaignReport', () => {
  const input = { ...parseReportSubmission(valid)!, actorUserId: 'admin-1' };

  it('writes one tagged campaign_reports row taken from the campaign, not the request', async () => {
    const { client, builders } = makeClient();
    await expect(saveCampaignReport(client, input)).resolves.toEqual({ status: 'saved', names: 4 });
    const [{ builder }] = calls(builders, 'campaign_reports', 'insert');
    const row = builder.insert.mock.calls[0][0];
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
      source: EXPERIMENTAL_REPORT_SOURCE,
    });
    expect(Number.isNaN(Date.parse(row.submitted_at))).toBe(false);
  });

  it('fills the derived state, location and leader from the campaign', async () => {
    const { client, builders } = makeClient();
    await saveCampaignReport(client, input);
    const [{ builder }] = calls(builders, 'campaign_reports', 'insert');
    expect(builder.insert.mock.calls[0][0]).toMatchObject({
      derived_state: 'VIC',
      derived_location: 'Orange',
      derived_leader: 'Jane Smith',
    });
  });

  it('only asks state_places for columns that exist (place, location) — there is no site column', async () => {
    const { client, builders } = makeClient();
    await saveCampaignReport(client, input);
    const [{ builder }] = builders.filter((b) => b.table === 'state_places');
    const selected = builder.select.mock.calls[0][0] as string;
    expect(selected.split(',').map((c) => c.trim()).sort()).toEqual(['location', 'place']);
  });

  it('trims the location it takes from State Places', async () => {
    const { client, builders } = makeClient({ campaign: { ...campaignRow, place: 'TestPlace', site: '' } });
    await saveCampaignReport(client, input);
    expect(calls(builders, 'campaign_reports', 'insert')[0].builder.insert.mock.calls[0][0].derived_location).toBe('Ashburton');
  });

  it('uses the place name as the location when State Places has none, and leaves it empty for an unknown place', async () => {
    const sylvania = makeClient({ campaign: { ...campaignRow, place: 'Sylvania', site: '' } });
    await saveCampaignReport(sylvania.client, input);
    expect(calls(sylvania.builders, 'campaign_reports', 'insert')[0].builder.insert.mock.calls[0][0].derived_location).toBe('Sylvania');

    const unknown = makeClient({ places: [] });
    await saveCampaignReport(unknown.client, input);
    expect(calls(unknown.builders, 'campaign_reports', 'insert')[0].builder.insert.mock.calls[0][0].derived_location).toBeNull();
  });

  it('writes every name to results under its category, tagged and attributed to the admin', async () => {
    const { client, builders } = makeClient();
    await saveCampaignReport(client, input);
    const [{ builder }] = calls(builders, 'results', 'insert');
    const rows = builder.insert.mock.calls[0][0];
    const base = { campaign_id: 'c1', user_id: 'admin-1', source: EXPERIMENTAL_REPORT_SOURCE };
    expect(rows).toEqual([
      { ...base, first_name: 'Ann', category_code: 'P' },
      { ...base, first_name: 'Bob', category_code: 'F' },
      { ...base, first_name: 'Cy Lee', category_code: 'F' },
      { ...base, first_name: 'Di', category_code: 'IR' },
    ]);
  });

  it('replaces an earlier save: clears only this campaign\'s experimental rows first', async () => {
    const { client, builders } = makeClient();
    await saveCampaignReport(client, input);
    for (const table of ['results', 'campaign_reports']) {
      const [{ builder }] = calls(builders, table, 'delete');
      expect(builder.eq).toHaveBeenCalledWith('campaign_id', 'c1');
      expect(builder.eq).toHaveBeenCalledWith('source', EXPERIMENTAL_REPORT_SOURCE);
    }
  });

  it('skips the results insert when there are no names', async () => {
    const { client, builders } = makeClient();
    const none = { ...input, counts: { partial: 0, full: 0, sinnersPrayers: 0, followUp: 0 }, names: { partial: [], full: [], sinnersPrayers: [], followUp: [] } };
    await expect(saveCampaignReport(client, none)).resolves.toEqual({ status: 'saved', names: 0 });
    expect(calls(builders, 'results', 'insert')).toHaveLength(0);
  });

  it('writes nothing when the campaign does not exist', async () => {
    const { client, builders } = makeClient({ campaign: null });
    await expect(saveCampaignReport(client, input)).resolves.toEqual({ status: 'campaign_not_found' });
    expect(calls(builders, 'campaign_reports', 'insert')).toHaveLength(0);
    expect(calls(builders, 'results', 'insert')).toHaveLength(0);
  });

  it('throws if the report row cannot be saved', async () => {
    const { client } = makeClient({ failTable: 'campaign_reports' });
    await expect(saveCampaignReport(client, input)).rejects.toThrow('Could not save the report');
  });

  it('undoes the report row and throws if the names cannot be saved', async () => {
    const { client, builders } = makeClient({ failTable: 'results' });
    await expect(saveCampaignReport(client, input)).rejects.toThrow('Could not save the names');
    // initial clear + undo = two delete rounds on campaign_reports
    expect(calls(builders, 'campaign_reports', 'delete')).toHaveLength(2);
  });
});
