import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getMyCampaignResults } from '../myCampaignResultsService';
import { makeQueryBuilder } from './supabaseMock';

const row = {
  id: 'r1', campaign_date: '2026-10-31', derived_location: 'Orange', location_raw: 'orange 1',
  partial_presentations: 2, full_presentations: 1, sinners_prayer: 0, information_requests: null,
};

function clientWith(result: { data: unknown; error: unknown }) {
  const builder = makeQueryBuilder(result);
  return { client: { from: vi.fn(() => builder) } as unknown as SupabaseClient, builder };
}

describe('getMyCampaignResults', () => {
  it("scopes the query to the caller's own state and leader, newest first", async () => {
    const { client, builder } = clientWith({ data: [], error: null });
    await getMyCampaignResults(client, { state: 'VIC', leader: 'Maria' });
    expect(builder.eq).toHaveBeenCalledWith('derived_state', 'VIC');
    expect(builder.eq).toHaveBeenCalledWith('derived_leader', 'Maria');
    expect(builder.order).toHaveBeenCalledWith('campaign_date', { ascending: false, nullsFirst: false });
  });

  it('returns only the date, location and four tallies', async () => {
    const { client } = clientWith({ data: [row], error: null });
    expect(await getMyCampaignResults(client, { state: 'VIC', leader: 'Maria' })).toEqual([
      { id: 'r1', campaignDate: '2026-10-31', location: 'Orange', partial: 2, full: 1, sinnersPrayers: 0, followUp: null },
    ]);
  });

  it('falls back to the typed location when none is mapped', async () => {
    const { client } = clientWith({ data: [{ ...row, derived_location: null }], error: null });
    const [r] = await getMyCampaignResults(client, { state: 'VIC', leader: 'Maria' });
    expect(r.location).toBe('orange 1');
  });

  it('throws on a query error rather than showing an empty list', async () => {
    const { client } = clientWith({ data: null, error: { message: 'boom' } });
    await expect(getMyCampaignResults(client, { state: 'VIC', leader: 'Maria' })).rejects.toThrow('boom');
  });
});
