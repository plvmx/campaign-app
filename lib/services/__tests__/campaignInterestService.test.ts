import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), auth: {} },
}));

import { supabase } from '@/lib/supabaseClient';
import { makeQueryBuilder } from './supabaseMock';
import {
  registerCampaignInterest,
  getCampaignInterestList,
  setCampaignInterestContacted,
} from '../campaignInterestService';

const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registerCampaignInterest', () => {
  it('inserts one row per entry', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await registerCampaignInterest([
      { campaignId: 'c1', firstName: 'Linda', mobile: '0400 000 001', interestType: 'in' },
      { campaignId: 'c2', firstName: 'Linda', mobile: '0400 000 001', interestType: 'in' },
    ]);
    expect(builder.insert).toHaveBeenCalledWith([
      { campaign_id: 'c1', first_name: 'Linda', mobile: '0400 000 001', interest_type: 'in' },
      { campaign_id: 'c2', first_name: 'Linda', mobile: '0400 000 001', interest_type: 'in' },
    ]);
  });

  it('does nothing (no query) when given an empty list', async () => {
    await registerCampaignInterest([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(
      registerCampaignInterest([{ campaignId: 'c1', firstName: 'Linda', mobile: '0400 000 001', interestType: 'more' }]),
    ).rejects.toEqual(error);
  });
});

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

describe('setCampaignInterestContacted', () => {
  it('sets contacted=true with a contacted_at timestamp', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await setCampaignInterestContacted('i1', true);
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ contacted: true, contacted_at: expect.any(String) }),
    );
    expect(builder.eq).toHaveBeenCalledWith('id', 'i1');
  });

  it('clears contacted_at back to null when un-marking', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await setCampaignInterestContacted('i1', false);
    expect(builder.update).toHaveBeenCalledWith({ contacted: false, contacted_at: null });
  });

  it('throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(setCampaignInterestContacted('i1', true)).rejects.toEqual(error);
  });
});
