import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), auth: {} },
}));

import { supabase } from '@/lib/supabaseClient';
import { makeQueryBuilder } from './supabaseMock';
import { getPlacesForState, getLeaderMobile, getCampaignCategories, getLeadersForState } from '../dropdownService';

const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getPlacesForState', () => {
  it('returns [] without querying when state is empty', async () => {
    expect(await getPlacesForState('')).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('normalizes state, dedupes, and sorts place names', async () => {
    const builder = makeQueryBuilder({
      data: [{ place: 'Geelong' }, { place: 'Melbourne' }, { place: 'Melbourne' }, { place: null }],
      error: null,
    });
    mockFrom.mockReturnValue(builder);
    const result = await getPlacesForState(' vic ');
    expect(builder.eq).toHaveBeenCalledWith('state', 'VIC');
    expect(result).toEqual(['Geelong', 'Melbourne']);
  });

  it('falls back to [] on error rather than throwing', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: { message: 'boom' } }));
    expect(await getPlacesForState('VIC')).toEqual([]);
  });
});

describe('getLeadersForState', () => {
  it('returns [] without querying when state is empty', async () => {
    expect(await getLeadersForState('')).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('normalizes state, dedupes, and sorts leader names', async () => {
    const builder = makeQueryBuilder({
      data: [{ leader: 'Bob' }, { leader: 'Alice' }, { leader: 'Alice' }],
      error: null,
    });
    mockFrom.mockReturnValue(builder);
    const result = await getLeadersForState(' vic ');
    expect(builder.eq).toHaveBeenCalledWith('state', 'VIC');
    expect(result).toEqual(['Alice', 'Bob']);
  });

  it('falls back to [] on error rather than throwing', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: { message: 'boom' } }));
    expect(await getLeadersForState('VIC')).toEqual([]);
  });
});

describe('getLeaderMobile', () => {
  it('returns null without querying when state or leader is empty', async () => {
    expect(await getLeaderMobile('', 'Alice')).toBeNull();
    expect(await getLeaderMobile('VIC', '')).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns the mobile number for a matching leader', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: { mobile: '0412345678' }, error: null }));
    expect(await getLeaderMobile('VIC', 'Alice')).toBe('0412345678');
  });

  it('returns null when no row matches (not a throw)', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: { code: 'PGRST116' } }));
    expect(await getLeaderMobile('VIC', 'Nobody')).toBeNull();
  });
});

describe('getCampaignCategories', () => {
  it('returns the ordered category list', async () => {
    const categories = [{ code: 'F', name: 'Full' }, { code: 'P', name: 'Partial' }];
    mockFrom.mockReturnValue(makeQueryBuilder({ data: categories, error: null }));
    expect(await getCampaignCategories()).toEqual(categories);
  });

  it('falls back to [] on error rather than throwing', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: { message: 'boom' } }));
    expect(await getCampaignCategories()).toEqual([]);
  });
});
