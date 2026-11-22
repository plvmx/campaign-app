import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeQueryBuilder } from './supabaseMock';
import { deriveCampaignReportFieldsSince } from '../campaignReportDeriveService';

describe('deriveCampaignReportFieldsSince', () => {
  function setup(rows: unknown[], aliasError: unknown = null) {
    const reports = makeQueryBuilder({ data: rows, error: null });
    const tables: Record<string, ReturnType<typeof makeQueryBuilder>> = {
      campaign_reports: reports,
      state_places: makeQueryBuilder({ data: [{ state: 'VIC', place: 'Dandenong', location: 'Dandenong' }], error: null }),
      state_leaders: makeQueryBuilder({ data: [{ state: 'VIC', leader: 'Brent' }], error: null }),
      campaign_report_location_aliases: makeQueryBuilder({ data: aliasError ? null : [{ location_key: 'herberton', state: 'QLD', location: 'Herberton' }], error: aliasError }),
    };
    return { client: { from: vi.fn((t: string) => tables[t]) } as unknown as SupabaseClient, reports };
  }
  const row = (o: object) => ({ id: 'r', location_raw: 'Dandenong', leader_raw: 'Brent', derived_state: null, derived_location: null, derived_leader: null, ...o });

  it('fills only empty fields, so a hand-entered value is never overwritten', async () => {
    const { client, reports } = setup([row({ id: 'a', derived_location: 'Hand Entered' })]);
    await deriveCampaignReportFieldsSince(client, '2000-01-01');
    expect(reports.update).toHaveBeenCalledWith({ derived_state: 'VIC', derived_location: 'Hand Entered', derived_leader: 'Brent' });
  });

  it('recomputes existing values when asked to overwrite', async () => {
    const { client, reports } = setup([row({ id: 'a', derived_location: 'Hand Entered' })]);
    await deriveCampaignReportFieldsSince(client, '2000-01-01', true, true);
    expect(reports.update).toHaveBeenCalledWith({ derived_state: 'VIC', derived_location: 'Dandenong', derived_leader: 'Brent' });
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

  it('applies confirmed aliases and counts rows that still have no location', async () => {
    const { client } = setup([row({ id: 'a', location_raw: 'Herberton' }), row({ id: 'b', location_raw: 'Mystery' })]);
    const r = await deriveCampaignReportFieldsSince(client, '2000-01-01', false);
    expect(r).toMatchObject({ inScope: 2, noLocationRows: 1, noLocationSpellings: 1, unresolved: 0 });
  });

  it('treats a not-yet-created aliases table as having no aliases', async () => {
    const { client } = setup([row({ id: 'a' })], { code: '42P01' });
    await expect(deriveCampaignReportFieldsSince(client, '2000-01-01', false)).resolves.toMatchObject({ inScope: 1 });
  });
});
