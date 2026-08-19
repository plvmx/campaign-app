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
  isTrainingCategory,
  getTrainingCampaigns,
  getTrainingInterestCounts,
  getTrainingInterestForCampaign,
  setTrainingInterestContacted,
} from '../trainingInterestService';
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

describe('isTrainingCategory', () => {
  it('is true for BOTJ and TLT', () => {
    expect(isTrainingCategory('BOTJ')).toBe(true);
    expect(isTrainingCategory('TLT')).toBe(true);
  });
  it('is false for other categories, null, or undefined', () => {
    expect(isTrainingCategory('TWOL')).toBe(false);
    expect(isTrainingCategory(null)).toBe(false);
    expect(isTrainingCategory(undefined)).toBe(false);
  });
});

describe('getTrainingCampaigns', () => {
  const baseParams = { adminStatus: null, userState: 'VIC', userLeader: 'Linda', userMobile: null, userId: 'u1' };

  it('filters getCampaignsForUser results down to training categories', async () => {
    mockGetCampaignsForUser.mockResolvedValueOnce({
      campaigns: [
        makeCampaign({ id: 'c1', category: 'TWOL' }),
        makeCampaign({ id: 'c2', category: 'BOTJ' }),
        makeCampaign({ id: 'c3', category: 'TLT' }),
        makeCampaign({ id: 'c4', category: null }),
      ],
      sharedOwners: [],
    });

    const result = await getTrainingCampaigns(baseParams);

    expect(result.map((c) => c.id)).toEqual(['c2', 'c3']);
    expect(mockGetCampaignsForUser).toHaveBeenCalledWith(baseParams);
  });

  it('returns an empty array when there are no training campaigns', async () => {
    mockGetCampaignsForUser.mockResolvedValueOnce({ campaigns: [makeCampaign({ category: 'TWOL' })], sharedOwners: [] });
    const result = await getTrainingCampaigns(baseParams);
    expect(result).toEqual([]);
  });
});

describe('getTrainingInterestCounts', () => {
  it('returns an empty map without querying when there are no campaign ids', async () => {
    const result = await getTrainingInterestCounts([]);
    expect(result).toEqual(new Map());
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('counts rows per campaign id', async () => {
    const builder = makeQueryBuilder({
      data: [{ campaign_id: 'c1' }, { campaign_id: 'c1' }, { campaign_id: 'c2' }],
      error: null,
    });
    mockFrom.mockReturnValueOnce(builder);

    const result = await getTrainingInterestCounts(['c1', 'c2']);

    expect(builder.in).toHaveBeenCalledWith('campaign_id', ['c1', 'c2']);
    expect(result.get('c1')).toBe(2);
    expect(result.get('c2')).toBe(1);
  });

  it('throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValueOnce(makeQueryBuilder({ data: null, error }));
    await expect(getTrainingInterestCounts(['c1'])).rejects.toEqual(error);
  });
});

describe('getTrainingInterestForCampaign', () => {
  it('returns rows newest first for the given campaign', async () => {
    const builder = makeQueryBuilder({
      data: [{ id: 'i1', campaign_id: 'c1', name: 'Sam', mobile: '0400', email: null, contacted: false, contacted_at: null, created_at: '2026-08-12T01:00:00Z' }],
      error: null,
    });
    mockFrom.mockReturnValueOnce(builder);

    const result = await getTrainingInterestForCampaign('c1');

    expect(builder.eq).toHaveBeenCalledWith('campaign_id', 'c1');
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(result[0].name).toBe('Sam');
  });

  it('throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValueOnce(makeQueryBuilder({ data: null, error }));
    await expect(getTrainingInterestForCampaign('c1')).rejects.toEqual(error);
  });
});

describe('setTrainingInterestContacted', () => {
  it('sets contacted=true with a contacted_at timestamp and returns it', async () => {
    const builder = makeQueryBuilder({ data: { contacted_at: '2026-08-19T00:00:00.000Z' }, error: null });
    mockFrom.mockReturnValue(builder);
    const result = await setTrainingInterestContacted('i1', true);
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ contacted: true, contacted_at: expect.any(String) }),
    );
    expect(builder.eq).toHaveBeenCalledWith('id', 'i1');
    expect(result).toEqual({ contacted_at: '2026-08-19T00:00:00.000Z' });
  });

  it('clears contacted_at back to null when un-marking', async () => {
    const builder = makeQueryBuilder({ data: { contacted_at: null }, error: null });
    mockFrom.mockReturnValue(builder);
    const result = await setTrainingInterestContacted('i1', false);
    expect(builder.update).toHaveBeenCalledWith({ contacted: false, contacted_at: null });
    expect(result).toEqual({ contacted_at: null });
  });

  it('throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(setTrainingInterestContacted('i1', true)).rejects.toEqual(error);
  });
});
