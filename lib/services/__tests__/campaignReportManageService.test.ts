import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeQueryBuilder } from './supabaseMock';
import { applyReportEdit, getEditLog, getManageData, toManageReport } from '../campaignReportManageService';

const ACTOR = { userId: 'u1', label: 'Peter_AD' };

function setup(opts: { report?: object | null; inState?: Record<string, boolean> } = {}) {
  const reports = makeQueryBuilder({ data: null, error: null });
  reports.maybeSingle = vi.fn().mockResolvedValue({
    data: opts.report === undefined ? { id: 'r1', derived_state: 'VIC', derived_place: 'Dandenong', derived_leader: 'Brent' } : opts.report,
    error: null,
  });
  const edits = makeQueryBuilder({ data: null, error: null });
  // state_places / state_leaders existence checks: answer by the name being looked up.
  const lookup = (table: string) => {
    const b = makeQueryBuilder({ data: [], error: null });
    let name = '';
    b.eq = vi.fn().mockImplementation((col: string, v: string) => { if (col === 'place' || col === 'leader') name = v; return b; });
    b.limit = vi.fn().mockImplementation(() => Promise.resolve({ data: opts.inState?.[`${table}:${name}`] ? [{}] : [], error: null }));
    return b;
  };
  const places = lookup('places');
  const leaders = lookup('leaders');
  const client = {
    from: vi.fn((t: string) => ({ campaign_reports: reports, campaign_report_edits: edits, state_places: places, state_leaders: leaders })[t]),
  } as unknown as SupabaseClient;
  return { client, reports, edits, places, leaders };
}

describe('applyReportEdit', () => {
  it('sets a state, clears a place and leader that do not exist in the new state, and audits all three', async () => {
    const { client, reports, edits } = setup();
    const r = await applyReportEdit(client, { id: 'r1', field: 'state', value: 'NSW', actor: ACTOR });
    expect(r).toEqual({ ok: true, report: { id: 'r1', state: 'NSW', place: null, matchedLeader: null } });
    expect(reports.update).toHaveBeenCalledWith({ derived_state: 'NSW', derived_place: null, derived_leader: null });
    expect(edits.insert).toHaveBeenCalledWith([
      expect.objectContaining({ field: 'derived_state', old_value: 'VIC', new_value: 'NSW', edited_by_label: 'Peter_AD' }),
      expect.objectContaining({ field: 'derived_place', old_value: 'Dandenong', new_value: null }),
      expect.objectContaining({ field: 'derived_leader', old_value: 'Brent', new_value: null }),
    ]);
  });

  it('keeps a place that also exists in the new state', async () => {
    const { client, reports } = setup({ inState: { 'places:Dandenong': true, 'leaders:Brent': true } });
    await applyReportEdit(client, { id: 'r1', field: 'state', value: 'SA', actor: ACTOR });
    expect(reports.update).toHaveBeenCalledWith({ derived_state: 'SA', derived_place: 'Dandenong', derived_leader: 'Brent' });
  });

  it('rejects an invalid state and a place edit when no state is set', async () => {
    const { client } = setup();
    expect(await applyReportEdit(client, { id: 'r1', field: 'state', value: 'XX', actor: ACTOR })).toMatchObject({ ok: false, status: 400 });
    const none = setup({ report: { id: 'r1', derived_state: null, derived_place: null, derived_leader: null } });
    expect(await applyReportEdit(none.client, { id: 'r1', field: 'place', value: 'Sale', actor: ACTOR }))
      .toMatchObject({ ok: false, status: 400, error: 'Choose a state first' });
  });

  it('accepts a place that is in State Places', async () => {
    const { client, reports } = setup({ inState: { 'places:Frankston': true } });
    const r = await applyReportEdit(client, { id: 'r1', field: 'place', value: 'Frankston', actor: ACTOR });
    expect(r.ok).toBe(true);
    expect(reports.update).toHaveBeenCalledWith({ derived_state: 'VIC', derived_place: 'Frankston', derived_leader: 'Brent' });
  });

  it('asks for confirmation before adding an unknown place, then adds it', async () => {
    const first = setup();
    expect(await applyReportEdit(first.client, { id: 'r1', field: 'place', value: 'Sale', actor: ACTOR }))
      .toMatchObject({ ok: false, status: 409, code: 'unknown_place' });
    expect(first.reports.update).not.toHaveBeenCalled();

    const second = setup();
    const r = await applyReportEdit(second.client, { id: 'r1', field: 'place', value: 'Sale', addPlace: true, actor: ACTOR });
    expect(r.ok).toBe(true);
    expect(second.places.insert).toHaveBeenCalledWith([{ state: 'VIC', place: 'Sale' }]);
  });

  it('only accepts a leader who is in that state', async () => {
    const { client, reports } = setup();
    expect(await applyReportEdit(client, { id: 'r1', field: 'leader', value: 'Nobody', actor: ACTOR })).toMatchObject({ ok: false, status: 400 });
    expect(reports.update).not.toHaveBeenCalled();
  });

  it('clearing a value stores null and is audited; an unchanged value writes no audit row', async () => {
    const { client, reports, edits } = setup();
    await applyReportEdit(client, { id: 'r1', field: 'place', value: '  ', actor: ACTOR });
    expect(reports.update).toHaveBeenCalledWith({ derived_state: 'VIC', derived_place: null, derived_leader: 'Brent' });
    expect(edits.insert).toHaveBeenCalledWith([expect.objectContaining({ field: 'derived_place', new_value: null })]);

    const same = setup({ inState: { 'places:Dandenong': true } });
    await applyReportEdit(same.client, { id: 'r1', field: 'place', value: 'Dandenong', actor: ACTOR });
    expect(same.edits.insert).not.toHaveBeenCalled();
  });

  it('404s for a report that does not exist', async () => {
    const { client } = setup({ report: null });
    expect(await applyReportEdit(client, { id: 'nope', field: 'state', value: 'VIC', actor: ACTOR })).toMatchObject({ ok: false, status: 404 });
  });
});

describe('getManageData / toManageReport', () => {
  it('shapes rows and returns the pick-lists', async () => {
    const row = {
      id: 'r1', submitted_at: '2026-01-01T00:00:00Z', campaign_date: '2026-01-01', campaign_date_raw: null, location_raw: 'Sale', leader_raw: 'Bob',
      derived_state: 'VIC', derived_place: null, derived_leader: null, partial_presentations: 2, full_presentations: 1, sinners_prayer: 0, information_requests: 3, needs_review: true,
    };
    const client = {
      from: vi.fn((t: string) => makeQueryBuilder({ data: t === 'campaign_reports' ? [row] : [{ state: 'VIC', place: 'X', leader: 'Y' }], error: null })),
    } as unknown as SupabaseClient;
    const data = await getManageData(client);
    expect(data.reports).toEqual([toManageReport(row)]);
    expect(data.reports[0]).toMatchObject({ location: 'Sale', state: 'VIC', place: null, infoRequests: 3, needsReview: true });
    expect(data.places).toHaveLength(1);
  });
});

describe('getEditLog', () => {
  it('pages the log and attaches each report\'s location and leader', async () => {
    const edits = makeQueryBuilder({
      data: [{ id: 'e1', report_id: 'r1', field: 'derived_place', old_value: null, new_value: 'Sale', edited_by_label: 'Peter_AD', edited_at: '2026-10-26T00:00:00Z' }],
      error: null,
    });
    (edits as unknown as { then: unknown }).then = ((f: (v: unknown) => unknown) =>
      Promise.resolve({ data: [{ id: 'e1', report_id: 'r1', field: 'derived_place', old_value: null, new_value: 'Sale', edited_by_label: 'Peter_AD', edited_at: '2026-10-26T00:00:00Z' }], error: null, count: 120 }).then(f));
    const reports = makeQueryBuilder({ data: [{ id: 'r1', location_raw: 'Sale', leader_raw: 'Bob' }], error: null });
    const client = { from: vi.fn((t: string) => (t === 'campaign_report_edits' ? edits : reports)) } as unknown as SupabaseClient;
    const log = await getEditLog(client, 2);
    expect(edits.range).toHaveBeenCalledWith(50, 99);
    expect(log).toMatchObject({ page: 2, pageSize: 50, total: 120 });
    expect(log.entries[0]).toMatchObject({ field: 'derived_place', newValue: 'Sale', location: 'Sale', leader: 'Bob', editedBy: 'Peter_AD' });
  });
});
