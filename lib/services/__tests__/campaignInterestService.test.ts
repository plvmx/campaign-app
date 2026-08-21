import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), auth: {} },
}));
vi.mock('../campaignService', () => ({
  getCampaignsForUser: vi.fn(),
}));

import { supabase } from '@/lib/supabaseClient';
import { makeQueryBuilder } from './supabaseMock';
import { getCampaignsForUser } from '../campaignService';
import {
  getCampaignInterestList,
  getCampaignInterestForLeader,
  getCampaignInterestCounts,
  setCampaignInterestContacted,
} from '../campaignInterestService';
import type { Campaign } from '@/lib/types';

const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;
const mockGetCampaignsForUser = vi.mocked(getCampaignsForUser);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeCampaign(overrides: Partial<Campaign>): Campaign {
  return {
    id: 'c1', date: '2026-08-12', state: 'VIC', place: 'Frankston', site: '',
    time: '11:30:00', leader: 'Linda', mobile: null, category: 'TWOL',
    tl_ok: false, sr_ok: false, created_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

describe('getCampaignInterestList', () => {
  it('returns an empty list without querying campaigns when there are no rows', async () => {
    const builder = makeQueryBuilder({ data: [], error: null });
    mockFrom.mockReturnValueOnce(builder);
    const result = await getCampaignInterestList();
    expect(result).toEqual([]);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('pairs each interest row with its campaign, newest first', async () => {
    const interestBuilder = makeQueryBuilder({
      data: [
        { id: 'i1', campaign_id: 'c1', first_name: 'Linda', mobile: '0400', interest_type: 'in', contacted: false, contacted_at: null, created_at: '2026-08-12T01:00:00Z' },
      ],
      error: null,
    });
    const campaignBuilder = makeQueryBuilder({
      data: [{ id: 'c1', date: '2026-08-12', state: 'VIC', place: 'Frankston', site: '', time: '11:30:00', leader: 'Linda' }],
      error: null,
    });
    mockFrom.mockReturnValueOnce(interestBuilder).mockReturnValueOnce(campaignBuilder);

    const result = await getCampaignInterestList();

    expect(interestBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(campaignBuilder.in).toHaveBeenCalledWith('id', ['c1']);
    expect(result).toEqual([
      {
        id: 'i1', campaign_id: 'c1', first_name: 'Linda', mobile: '0400', interest_type: 'in', contacted: false, contacted_at: null, created_at: '2026-08-12T01:00:00Z',
        campaign: { id: 'c1', date: '2026-08-12', state: 'VIC', place: 'Frankston', site: '', time: '11:30:00', leader: 'Linda' },
      },
    ]);
  });

  it('pairs with a null campaign when the referenced campaign is missing', async () => {
    const interestBuilder = makeQueryBuilder({
      data: [{ id: 'i1', campaign_id: 'missing', first_name: 'Linda', mobile: '0400', interest_type: 'in', contacted: false, contacted_at: null, created_at: '2026-08-12T01:00:00Z' }],
      error: null,
    });
    const campaignBuilder = makeQueryBuilder({ data: [], error: null });
    mockFrom.mockReturnValueOnce(interestBuilder).mockReturnValueOnce(campaignBuilder);

    const result = await getCampaignInterestList();
    expect(result[0].campaign).toBeNull();
  });

  it('throws on interest query error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValueOnce(makeQueryBuilder({ data: null, error }));
    await expect(getCampaignInterestList()).rejects.toEqual(error);
  });

  it('throws on campaign query error', async () => {
    const interestBuilder = makeQueryBuilder({
      data: [{ id: 'i1', campaign_id: 'c1', first_name: 'Linda', mobile: '0400', interest_type: 'in', contacted: false, contacted_at: null, created_at: '' }],
      error: null,
    });
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValueOnce(interestBuilder).mockReturnValueOnce(makeQueryBuilder({ data: null, error }));
    await expect(getCampaignInterestList()).rejects.toEqual(error);
  });
});

describe('getCampaignInterestForLeader', () => {
  const baseParams = { adminStatus: null, userState: 'VIC', userLeader: 'Linda', userMobile: null, userId: 'u1' };

  it('returns an empty list without querying campaign_interest when the leader has no campaigns', async () => {
    mockGetCampaignsForUser.mockResolvedValueOnce({ campaigns: [], sharedOwners: [] });
    const result = await getCampaignInterestForLeader(baseParams);
    expect(result).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('pairs each interest row with its campaign from getCampaignsForUser, scoped to that campaign set', async () => {
    mockGetCampaignsForUser.mockResolvedValueOnce({
      campaigns: [makeCampaign({ id: 'c1', place: 'Frankston' })],
      sharedOwners: [],
    });
    const interestBuilder = makeQueryBuilder({
      data: [{ id: 'i1', campaign_id: 'c1', first_name: 'Sam', mobile: '0400', interest_type: 'more', contacted: false, contacted_at: null, created_at: '2026-08-12T01:00:00Z' }],
      error: null,
    });
    mockFrom.mockReturnValueOnce(interestBuilder);

    const result = await getCampaignInterestForLeader(baseParams);

    expect(mockGetCampaignsForUser).toHaveBeenCalledWith(baseParams);
    expect(interestBuilder.in).toHaveBeenCalledWith('campaign_id', ['c1']);
    expect(interestBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(result[0].campaign?.place).toBe('Frankston');
  });

  it('pairs with a null campaign when the row references a campaign outside the fetched set', async () => {
    mockGetCampaignsForUser.mockResolvedValueOnce({ campaigns: [makeCampaign({ id: 'c1' })], sharedOwners: [] });
    const interestBuilder = makeQueryBuilder({
      data: [{ id: 'i1', campaign_id: 'other', first_name: 'Sam', mobile: '0400', interest_type: 'in', contacted: false, contacted_at: null, created_at: '' }],
      error: null,
    });
    mockFrom.mockReturnValueOnce(interestBuilder);

    const result = await getCampaignInterestForLeader(baseParams);
    expect(result[0].campaign).toBeNull();
  });

  it('throws on error', async () => {
    mockGetCampaignsForUser.mockResolvedValueOnce({ campaigns: [makeCampaign({})], sharedOwners: [] });
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValueOnce(makeQueryBuilder({ data: null, error }));
    await expect(getCampaignInterestForLeader(baseParams)).rejects.toEqual(error);
  });
});

describe('getCampaignInterestCounts', () => {
  it('returns an empty map without querying when there are no campaign ids', async () => {
    const result = await getCampaignInterestCounts([]);
    expect(result).toEqual(new Map());
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('counts rows per campaign id', async () => {
    const builder = makeQueryBuilder({
      data: [{ campaign_id: 'c1' }, { campaign_id: 'c1' }, { campaign_id: 'c2' }],
      error: null,
    });
    mockFrom.mockReturnValueOnce(builder);

    const result = await getCampaignInterestCounts(['c1', 'c2']);

    expect(builder.in).toHaveBeenCalledWith('campaign_id', ['c1', 'c2']);
    expect(result.get('c1')).toBe(2);
    expect(result.get('c2')).toBe(1);
  });

  it('throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValueOnce(makeQueryBuilder({ data: null, error }));
    await expect(getCampaignInterestCounts(['c1'])).rejects.toEqual(error);
  });
});

describe('setCampaignInterestContacted', () => {
  it('sets contacted=true with a contacted_at timestamp and returns it', async () => {
    const builder = makeQueryBuilder({ data: { contacted_at: '2026-08-19T00:00:00.000Z' }, error: null });
    mockFrom.mockReturnValue(builder);
    const result = await setCampaignInterestContacted('i1', true);
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ contacted: true, contacted_at: expect.any(String) }),
    );
    expect(builder.eq).toHaveBeenCalledWith('id', 'i1');
    expect(result).toEqual({ contacted_at: '2026-08-19T00:00:00.000Z' });
  });

  it('clears contacted_at back to null when un-marking', async () => {
    const builder = makeQueryBuilder({ data: { contacted_at: null }, error: null });
    mockFrom.mockReturnValue(builder);
    const result = await setCampaignInterestContacted('i1', false);
    expect(builder.update).toHaveBeenCalledWith({ contacted: false, contacted_at: null });
    expect(result).toEqual({ contacted_at: null });
  });

  it('throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(setCampaignInterestContacted('i1', true)).rejects.toEqual(error);
  });
});
