import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), auth: {} },
}));
vi.mock('@/lib/campaignLog', () => ({
  logCampaignChange: vi.fn(),
}));
vi.mock('@/lib/leaderShares', () => ({
  getSharedWithMeOwners: vi.fn(),
}));
vi.mock('@/lib/services/rulesService', () => ({
  excludeDateForDeletedCampaign: vi.fn(),
}));

import { supabase } from '@/lib/supabaseClient';
import { logCampaignChange } from '@/lib/campaignLog';
import { getSharedWithMeOwners } from '@/lib/leaderShares';
import { excludeDateForDeletedCampaign } from '@/lib/services/rulesService';
import { makeQueryBuilder } from './supabaseMock';
import {
  getCampaignById,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  getCampaignsByDateRange,
  findCampaign,
  findCampaignsByKey,
  getCampaignsForUser,
} from '../campaignService';
import type { Campaign } from '@/lib/types';

const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;
const mockGetSharedWithMeOwners = vi.mocked(getSharedWithMeOwners);

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'c1',
    date: '2026-01-05',
    state: 'VIC',
    place: 'Melbourne',
    site: '',
    time: '10:00',
    leader: 'Alice',
    mobile: '0412345678',
    category: 'TWOL',
    tl_ok: false,
    sr_ok: false,
    created_at: '2026-01-01T00:00:00Z',
    user_id: 'user-1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getCampaignById', () => {
  it('returns the campaign when found', async () => {
    const campaign = makeCampaign();
    mockFrom.mockReturnValue(makeQueryBuilder({ data: campaign, error: null }));
    expect(await getCampaignById('c1')).toEqual(campaign);
  });

  it('returns null when not found (PGRST116)', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: { code: 'PGRST116' } }));
    expect(await getCampaignById('missing')).toBeNull();
  });

  it('throws on other errors', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(getCampaignById('c1')).rejects.toEqual(error);
  });
});

describe('createCampaign', () => {
  it('inserts trimmed fields, returns the created row, and logs the insert', async () => {
    const created = makeCampaign();
    const builder = makeQueryBuilder({ data: created, error: null });
    mockFrom.mockReturnValue(builder);

    const result = await createCampaign({
      date: '2026-01-05',
      state: ' VIC ',
      place: ' Melbourne ',
      site: '',
      time: '10:00',
      leader: ' Alice ',
      mobile: '0412345678',
      category: 'TWOL',
      user_id: 'user-1',
    });

    expect(result).toEqual(created);
    expect(builder.insert).toHaveBeenCalledWith([
      expect.objectContaining({ state: 'VIC', place: 'Melbourne', leader: 'Alice' }),
    ]);
    expect(logCampaignChange).toHaveBeenCalledWith('c1', 'INSERT', null, created);
  });

  it('throws on error and does not log', async () => {
    const error = { code: '23505', message: 'duplicate' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(
      createCampaign({
        date: '2026-01-05', state: 'VIC', place: 'Melbourne', site: '', time: '10:00',
        leader: 'Alice', mobile: null, category: 'TWOL', user_id: 'user-1',
      }),
    ).rejects.toEqual(error);
    expect(logCampaignChange).not.toHaveBeenCalled();
  });

  it('rejects a blank leader without hitting the database — the service layer is the single choke point for every caller (form UI, /capture, /record-results)', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await expect(
      createCampaign({
        date: '2026-01-05', state: 'VIC', place: 'Melbourne', site: '', time: '10:00',
        leader: '   ', mobile: null, category: 'TWOL', user_id: 'user-1',
      }),
    ).rejects.toThrow('Leader is required');
    expect(builder.insert).not.toHaveBeenCalled();
    expect(logCampaignChange).not.toHaveBeenCalled();
  });
});

describe('updateCampaign', () => {
  it('updates, returns the row, and logs the update with old data', async () => {
    const updated = makeCampaign({ time: '11:00' });
    mockFrom.mockReturnValue(makeQueryBuilder({ data: updated, error: null }));
    const oldData = makeCampaign();
    const result = await updateCampaign('c1', { time: '11:00' }, oldData);
    expect(result).toEqual(updated);
    expect(logCampaignChange).toHaveBeenCalledWith('c1', 'UPDATE', oldData, updated);
  });

  it('throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(updateCampaign('c1', { time: '11:00' })).rejects.toEqual(error);
  });

  it('rejects an update that blanks out the leader field', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await expect(updateCampaign('c1', { leader: '' })).rejects.toThrow('Leader is required');
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('allows partial updates that never touch leader (e.g. tl_ok, actual_leader) even when leader is not supplied', async () => {
    const updated = makeCampaign({ tl_ok: true });
    mockFrom.mockReturnValue(makeQueryBuilder({ data: updated, error: null }));
    const result = await updateCampaign('c1', { tl_ok: true });
    expect(result).toEqual(updated);
  });
});

describe('deleteCampaign', () => {
  it('deletes and logs the deletion', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    const oldData = makeCampaign();
    await deleteCampaign('c1', oldData);
    expect(logCampaignChange).toHaveBeenCalledWith('c1', 'DELETE', oldData, null);
  });

  it('throws on error and does not log', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(deleteCampaign('c1')).rejects.toEqual(error);
    expect(logCampaignChange).not.toHaveBeenCalled();
  });

  it('records a rule exception when deleting a rule-generated campaign, so the next weekly refresh does not recreate it', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    const oldData = makeCampaign({ source: 'RUL' });
    await deleteCampaign('c1', oldData);
    expect(excludeDateForDeletedCampaign).toHaveBeenCalledWith({
      date: oldData.date,
      state: oldData.state,
      place: oldData.place,
      site: oldData.site,
      time: oldData.time,
      leader: oldData.leader,
    });
  });

  it('does not record a rule exception for a manually-created campaign', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    const oldData = makeCampaign({ source: 'MAN' });
    await deleteCampaign('c1', oldData);
    expect(excludeDateForDeletedCampaign).not.toHaveBeenCalled();
  });

  it('does not record a rule exception when no oldData is passed', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    await deleteCampaign('c1');
    expect(excludeDateForDeletedCampaign).not.toHaveBeenCalled();
  });
});

describe('getCampaignsByDateRange', () => {
  it('applies an uppercased/trimmed state filter when given one', async () => {
    const builder = makeQueryBuilder({ data: [makeCampaign()], error: null });
    mockFrom.mockReturnValue(builder);
    const result = await getCampaignsByDateRange({ startDate: '2026-01-01', endDate: '2026-01-31', state: ' vic ' });
    expect(result).toHaveLength(1);
    expect(builder.eq).toHaveBeenCalledWith('state', 'VIC');
  });

  it('returns [] rather than null when no rows found', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    expect(await getCampaignsByDateRange({ startDate: '2026-01-01', endDate: '2026-01-31' })).toEqual([]);
  });
});

describe('findCampaign / findCampaignsByKey', () => {
  it('findCampaign returns null when no match', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    expect(
      await findCampaign({ date: '2026-01-05', state: 'VIC', place: 'Melbourne', site: '', time: '10:00', leader: 'Alice' }),
    ).toBeNull();
  });

  it('findCampaignsByKey returns an array of matches', async () => {
    mockFrom.mockReturnValue(
      makeQueryBuilder({ data: [{ id: 'c1', mobile: null, state: 'VIC', leader: 'Alice' }], error: null }),
    );
    const result = await findCampaignsByKey({ date: '2026-01-05', state: 'VIC', place: 'Melbourne', site: '', time: '10:00', leader: 'Alice' });
    expect(result).toEqual([{ id: 'c1', mobile: null, state: 'VIC', leader: 'Alice' }]);
  });
});

// ---------------------------------------------------------------------------
// getCampaignsForUser — the role-based data-access gate. #78 was a role-check
// bug at the login layer; this is the function that actually decides what
// data a leader can see, so its branch logic is the highest-value target.
// ---------------------------------------------------------------------------
describe('getCampaignsForUser', () => {
  const baseParams = {
    userState: 'VIC',
    userLeader: 'Alice',
    userMobile: '0412345678',
    userId: 'user-1',
  };

  it('AD sees everything — no state/user_id/leader filter applied', async () => {
    const builder = makeQueryBuilder({ data: [makeCampaign()], error: null });
    mockFrom.mockReturnValue(builder);
    const result = await getCampaignsForUser({ ...baseParams, adminStatus: 'AD' });
    expect(result.campaigns).toHaveLength(1);
    expect(builder.eq).not.toHaveBeenCalled();
    expect(mockGetSharedWithMeOwners).not.toHaveBeenCalled();
  });

  it('SR with a state filters by that state only', async () => {
    const builder = makeQueryBuilder({ data: [makeCampaign()], error: null });
    mockFrom.mockReturnValue(builder);
    await getCampaignsForUser({ ...baseParams, adminStatus: 'SR' });
    expect(builder.eq).toHaveBeenCalledWith('state', 'VIC');
    expect(builder.eq).not.toHaveBeenCalledWith('user_id', expect.anything());
  });

  it('SR without a state falls back to filtering by their own user_id', async () => {
    const builder = makeQueryBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await getCampaignsForUser({ ...baseParams, adminStatus: 'SR', userState: null });
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('regular leader with a leader+state filters by leader name and checks shared owners', async () => {
    mockGetSharedWithMeOwners.mockResolvedValue([]);
    const builder = makeQueryBuilder({ data: [makeCampaign()], error: null });
    mockFrom.mockReturnValue(builder);
    await getCampaignsForUser({ ...baseParams, adminStatus: null });
    expect(mockGetSharedWithMeOwners).toHaveBeenCalledWith('VIC', 'Alice');
    expect(builder.eq).toHaveBeenCalledWith('leader', 'Alice');
  });

  it('regular leader without a leader/state falls back to filtering by their own user_id', async () => {
    const builder = makeQueryBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await getCampaignsForUser({ ...baseParams, adminStatus: null, userLeader: null });
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(mockGetSharedWithMeOwners).not.toHaveBeenCalled();
  });

  it('merges in shared-owner campaigns, deduped by id, for a regular leader', async () => {
    mockGetSharedWithMeOwners.mockResolvedValue([{ owner_state: 'NSW', owner_leader: 'Bob' }]);
    const own = makeCampaign({ id: 'own-1', mobile: '0412345678' });
    const shared = makeCampaign({ id: 'shared-1', state: 'NSW', leader: 'Bob', mobile: null });
    mockFrom
      .mockReturnValueOnce(makeQueryBuilder({ data: [own], error: null }))
      .mockReturnValueOnce(makeQueryBuilder({ data: [shared], error: null }));

    const result = await getCampaignsForUser({ ...baseParams, adminStatus: null });
    expect(result.campaigns.map((c) => c.id).sort()).toEqual(['own-1', 'shared-1']);
    expect(result.sharedOwners).toEqual([{ owner_state: 'NSW', owner_leader: 'Bob' }]);
  });

  it('filters out campaigns that are neither own (by mobile) nor shared', async () => {
    mockGetSharedWithMeOwners.mockResolvedValue([]);
    const mine = makeCampaign({ id: 'mine', mobile: '0412345678' });
    const notMine = makeCampaign({ id: 'not-mine', mobile: '0499999999' });
    mockFrom.mockReturnValue(makeQueryBuilder({ data: [mine, notMine], error: null }));

    const result = await getCampaignsForUser({ ...baseParams, adminStatus: null });
    expect(result.campaigns.map((c) => c.id)).toEqual(['mine']);
  });

  it('throws when the main query errors', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(getCampaignsForUser({ ...baseParams, adminStatus: 'AD' })).rejects.toEqual(error);
  });
});
