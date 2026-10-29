import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeQueryBuilder } from './supabaseMock';

vi.mock('@/lib/geocoding', () => ({
  geocodePlace: vi.fn().mockResolvedValue({ latitude: -38.11, longitude: 147.07 }),
}));

import { applyReportEdit, getEditLog, getManageData, toManageReport } from '../campaignReportManageService';

const ACTOR = { userId: 'u1', label: 'Peter_AD' };

interface StatePlaceRow { state: string; place: string; location: string | null }

/**
 * Fake client. `places` is what state_places holds (the existing-location check
 * reads it filtered by state); `leadersInState` names the leaders that exist.
 */
function setup(opts: { report?: object | null; places?: StatePlaceRow[]; leadersInState?: string[] } = {}) {
  const reports = makeQueryBuilder({ data: null, error: null });
  reports.maybeSingle = vi.fn().mockResolvedValue({
    data: opts.report === undefined ? { id: 'r1', derived_state: 'VIC', derived_location: 'Dandenong', derived_leader: 'Brent' } : opts.report,
    error: null,
  });
  const edits = makeQueryBuilder({ data: null, error: null });

  const statePlaces = makeQueryBuilder({ data: [], error: null });
  let stateFilter = '';
  statePlaces.eq = vi.fn().mockImplementation((col: string, v: string) => { if (col === 'state') stateFilter = v; return statePlaces; });
  (statePlaces as unknown as { then: unknown }).then = ((f: (v: unknown) => unknown) =>
    Promise.resolve({ data: (opts.places ?? []).filter((p) => p.state === stateFilter), error: null }).then(f));

  const leaders = makeQueryBuilder({ data: [], error: null });
  let leaderName = '';
  leaders.eq = vi.fn().mockImplementation((col: string, v: string) => { if (col === 'leader') leaderName = v; return leaders; });
  leaders.limit = vi.fn().mockImplementation(() => Promise.resolve({ data: opts.leadersInState?.includes(leaderName) ? [{}] : [], error: null }));

  const client = {
    from: vi.fn((t: string) => ({ campaign_reports: reports, campaign_report_edits: edits, state_places: statePlaces, state_leaders: leaders })[t]),
  } as unknown as SupabaseClient;
  return { client, reports, edits, statePlaces, leaders };
}

const place = (state: string, p: string, location: string | null = p): StatePlaceRow => ({ state, place: p, location });

describe('applyReportEdit', () => {
  it('sets a state, clears a location and leader that do not exist in the new state, and audits all three', async () => {
    const { client, reports, edits } = setup({ places: [place('VIC', 'Dandenong')] });
    const r = await applyReportEdit(client, { id: 'r1', field: 'state', value: 'NSW', actor: ACTOR });
    expect(r).toEqual({ ok: true, report: { id: 'r1', state: 'NSW', location: null, matchedLeader: null } });
    expect(reports.update).toHaveBeenCalledWith({ derived_state: 'NSW', derived_location: null, derived_leader: null });
    expect(edits.insert).toHaveBeenCalledWith([
      expect.objectContaining({ field: 'derived_state', old_value: 'VIC', new_value: 'NSW', edited_by_label: 'Peter_AD' }),
      expect.objectContaining({ field: 'derived_location', old_value: 'Dandenong', new_value: null }),
      expect.objectContaining({ field: 'derived_leader', old_value: 'Brent', new_value: null }),
    ]);
  });

  it('keeps a location (and leader) that also exists in the new state', async () => {
    const { client, reports } = setup({ places: [place('SA', 'Dandenong')], leadersInState: ['Brent'] });
    await applyReportEdit(client, { id: 'r1', field: 'state', value: 'SA', actor: ACTOR });
    expect(reports.update).toHaveBeenCalledWith({ derived_state: 'SA', derived_location: 'Dandenong', derived_leader: 'Brent' });
  });

  it('rejects an invalid state and a location edit when no state is set', async () => {
    const { client } = setup();
    expect(await applyReportEdit(client, { id: 'r1', field: 'state', value: 'XX', actor: ACTOR })).toMatchObject({ ok: false, status: 400 });
    const none = setup({ report: { id: 'r1', derived_state: null, derived_location: null, derived_leader: null } });
    expect(await applyReportEdit(none.client, { id: 'r1', field: 'location', value: 'Sale', actor: ACTOR }))
      .toMatchObject({ ok: false, status: 400, error: 'Choose a state first' });
  });

  it('accepts a location in State Places, and stores its stored spelling', async () => {
    const { client, reports } = setup({ places: [place('VIC', 'Frankston 1', 'Frankston')] });
    const r = await applyReportEdit(client, { id: 'r1', field: 'location', value: 'frankston', actor: ACTOR });
    expect(r.ok).toBe(true);
    expect(reports.update).toHaveBeenCalledWith({ derived_state: 'VIC', derived_location: 'Frankston', derived_leader: 'Brent' });
  });

  it('accepts a location that is only the physical location of numbered places (Perth CBD 1…4 -> Perth CBD)', async () => {
    const { client } = setup({
      report: { id: 'r1', derived_state: 'WA', derived_location: null, derived_leader: null },
      places: [place('WA', 'Perth CBD 1', 'Perth CBD'), place('WA', 'Perth CBD 2', 'Perth CBD')],
    });
    expect((await applyReportEdit(client, { id: 'r1', field: 'location', value: 'Perth CBD', actor: ACTOR })).ok).toBe(true);
  });

  it('asks for confirmation before adding an unknown location, then adds it as a geocoded State Places row', async () => {
    const first = setup();
    expect(await applyReportEdit(first.client, { id: 'r1', field: 'location', value: 'Sale', actor: ACTOR }))
      .toMatchObject({ ok: false, status: 409, code: 'unknown_location' });
    expect(first.reports.update).not.toHaveBeenCalled();

    const second = setup();
    const r = await applyReportEdit(second.client, { id: 'r1', field: 'location', value: 'Sale', addLocation: true, actor: ACTOR });
    expect(r.ok).toBe(true);
    expect(second.statePlaces.insert).toHaveBeenCalledWith([
      { state: 'VIC', place: 'Sale', location: 'Sale', latitude: -38.11, longitude: 147.07 },
    ]);
  });

  it('only accepts a leader who is in that state', async () => {
    const { client, reports } = setup();
    expect(await applyReportEdit(client, { id: 'r1', field: 'leader', value: 'Nobody', actor: ACTOR })).toMatchObject({ ok: false, status: 400 });
    expect(reports.update).not.toHaveBeenCalled();
  });

  it('clearing a value stores null and is audited; an unchanged value writes no audit row', async () => {
    const { client, reports, edits } = setup();
    await applyReportEdit(client, { id: 'r1', field: 'location', value: '  ', actor: ACTOR });
    expect(reports.update).toHaveBeenCalledWith({ derived_state: 'VIC', derived_location: null, derived_leader: 'Brent' });
    expect(edits.insert).toHaveBeenCalledWith([expect.objectContaining({ field: 'derived_location', new_value: null })]);

    const same = setup({ places: [place('VIC', 'Dandenong')] });
    await applyReportEdit(same.client, { id: 'r1', field: 'location', value: 'Dandenong', actor: ACTOR });
    expect(same.edits.insert).not.toHaveBeenCalled();
  });

  it('404s for a report that does not exist', async () => {
    const { client } = setup({ report: null });
    expect(await applyReportEdit(client, { id: 'nope', field: 'state', value: 'VIC', actor: ACTOR })).toMatchObject({ ok: false, status: 404 });
  });
});

describe('getManageData / toManageReport', () => {
  it('shapes rows (typed location vs mapped location) and returns the distinct pick-lists', async () => {
    const row = {
      id: 'r1', submitted_at: '2026-01-01T00:00:00Z', campaign_date: '2026-01-01', campaign_date_raw: null, location_raw: 'Sale', leader_raw: 'Bob',
      derived_state: 'VIC', derived_location: null, derived_leader: null, partial_presentations: 2, full_presentations: 1, sinners_prayer: 0, information_requests: 3, needs_review: true,
    };
    const client = {
      from: vi.fn((t: string) => makeQueryBuilder({
        data: t === 'campaign_reports' ? [row] : t === 'state_places'
          ? [{ state: 'VIC', place: 'Frankston 1', location: 'Frankston' }, { state: 'VIC', place: 'Frankston 2', location: 'Frankston' }]
          : [{ state: 'VIC', leader: 'Y' }],
        error: null,
      })),
    } as unknown as SupabaseClient;
    const data = await getManageData(client);
    expect(data.reports).toEqual([toManageReport(row)]);
    expect(data.reports[0]).toMatchObject({ locationTyped: 'Sale', state: 'VIC', location: null, infoRequests: 3, needsReview: true });
    expect(data.locations).toEqual([{ state: 'VIC', location: 'Frankston' }]);
  });
});

describe('getEditLog', () => {
  it('pages the log and attaches each report\'s typed location and leader', async () => {
    const entry = { id: 'e1', report_id: 'r1', field: 'derived_location', old_value: null, new_value: 'Sale', edited_by_label: 'Peter_AD', edited_at: '2026-10-26T00:00:00Z' };
    const edits = makeQueryBuilder({ data: [entry], error: null });
    (edits as unknown as { then: unknown }).then = ((f: (v: unknown) => unknown) => Promise.resolve({ data: [entry], error: null, count: 120 }).then(f));
    const reports = makeQueryBuilder({ data: [{ id: 'r1', location_raw: 'Sale', leader_raw: 'Bob' }], error: null });
    const client = { from: vi.fn((t: string) => (t === 'campaign_report_edits' ? edits : reports)) } as unknown as SupabaseClient;
    const log = await getEditLog(client, 2);
    expect(edits.range).toHaveBeenCalledWith(50, 99);
    expect(log).toMatchObject({ page: 2, pageSize: 50, total: 120 });
    expect(log.entries[0]).toMatchObject({ field: 'derived_location', newValue: 'Sale', locationTyped: 'Sale', leader: 'Bob', editedBy: 'Peter_AD' });
  });
});
