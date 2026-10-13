import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeQueryBuilder, type MockQueryBuilder } from './supabaseMock';
import { getVisibleInterestCounts, MAX_CAMPAIGN_IDS } from '../interestCountsService';

function setup(opts: {
  visibleCampaigns?: { id: string }[];
  campaignInterest?: { campaign_id: string }[];
  trainingInterest?: { campaign_id: string }[];
  userError?: unknown;
} = {}) {
  const userBuilder = makeQueryBuilder({ data: opts.visibleCampaigns ?? [], error: opts.userError ?? null });
  const adminBuilders: Record<string, MockQueryBuilder> = {
    campaign_interest: makeQueryBuilder({ data: opts.campaignInterest ?? [], error: null }),
    training_interest: makeQueryBuilder({ data: opts.trainingInterest ?? [], error: null }),
  };
  const userClient = { from: vi.fn(() => userBuilder) } as unknown as SupabaseClient;
  const adminClient = { from: vi.fn((t: string) => adminBuilders[t]) } as unknown as SupabaseClient;
  return { userClient, adminClient, userBuilder, adminBuilders };
}

describe('getVisibleInterestCounts', () => {
  it('counts per campaign for both kinds of registration', async () => {
    const { userClient, adminClient } = setup({
      visibleCampaigns: [{ id: 'c1' }, { id: 'c2' }],
      campaignInterest: [{ campaign_id: 'c1' }, { campaign_id: 'c1' }, { campaign_id: 'c2' }],
      trainingInterest: [{ campaign_id: 'c2' }],
    });
    expect(await getVisibleInterestCounts(userClient, adminClient, ['c1', 'c2'])).toEqual({
      campaignInterest: { c1: 2, c2: 1 },
      trainingInterest: { c2: 1 },
    });
  });

  it('only counts campaigns the caller\'s OWN session can see — asking about someone else\'s campaign reveals nothing', async () => {
    const { userClient, adminClient, userBuilder, adminBuilders } = setup({ visibleCampaigns: [{ id: 'mine' }] });
    await getVisibleInterestCounts(userClient, adminClient, ['mine', 'someone-elses']);

    expect(userBuilder.in).toHaveBeenCalledWith('id', ['mine', 'someone-elses']);
    // the service-role client is only ever asked about the visible one
    expect(adminBuilders.campaign_interest.in).toHaveBeenCalledWith('campaign_id', ['mine']);
    expect(adminBuilders.training_interest.in).toHaveBeenCalledWith('campaign_id', ['mine']);
  });

  it('does not touch the registrations at all when none of the campaigns are visible', async () => {
    const { userClient, adminClient, adminBuilders } = setup({ visibleCampaigns: [] });
    expect(await getVisibleInterestCounts(userClient, adminClient, ['x'])).toEqual({ campaignInterest: {}, trainingInterest: {} });
    expect(adminBuilders.campaign_interest.in).not.toHaveBeenCalled();
  });

  it('returns nothing for an empty request without any query', async () => {
    const { userClient, adminClient } = setup();
    expect(await getVisibleInterestCounts(userClient, adminClient, [])).toEqual({ campaignInterest: {}, trainingInterest: {} });
    expect(userClient.from).not.toHaveBeenCalled();
  });

  it('de-duplicates and caps the number of ids', async () => {
    const { userClient, adminClient, userBuilder } = setup();
    const many = Array.from({ length: MAX_CAMPAIGN_IDS + 50 }, (_, i) => `c${i}`);
    await getVisibleInterestCounts(userClient, adminClient, ['a', 'a', ...many]);
    const asked = (userBuilder.in.mock.calls[0] as [string, string[]])[1];
    expect(asked).toHaveLength(MAX_CAMPAIGN_IDS);
    expect(new Set(asked).size).toBe(asked.length);
  });

  it('throws if the visibility lookup fails, rather than returning zero counts', async () => {
    const { userClient, adminClient } = setup({ userError: { message: 'boom' } });
    await expect(getVisibleInterestCounts(userClient, adminClient, ['c1'])).rejects.toEqual({ message: 'boom' });
  });
});
