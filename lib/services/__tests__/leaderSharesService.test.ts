import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), auth: {} },
}));

import { supabase } from '@/lib/supabaseClient';
import { makeQueryBuilder } from './supabaseMock';
import { getLeaderShares, createLeaderShare, deleteLeaderShare } from '../leaderSharesService';

const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getLeaderShares', () => {
  it('returns all shares ordered by owner state then leader', async () => {
    const row = { id: '1', owner_state: 'VIC', owner_leader: 'Alice', shared_with_state: 'NSW', shared_with_leader: 'Bob', created_at: '' };
    const builder = makeQueryBuilder({ data: [row], error: null });
    mockFrom.mockReturnValue(builder);
    const result = await getLeaderShares();
    expect(result).toEqual([row]);
    expect(builder.order).toHaveBeenCalledWith('owner_state', { ascending: true });
    expect(builder.order).toHaveBeenCalledWith('owner_leader', { ascending: true });
  });

  it('returns [] rather than null when no rows found', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    expect(await getLeaderShares()).toEqual([]);
  });

  it('throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(getLeaderShares()).rejects.toEqual(error);
  });
});

describe('createLeaderShare', () => {
  const input = { owner_state: 'VIC', owner_leader: 'Alice', shared_with_state: 'NSW', shared_with_leader: 'Bob' };

  it('inserts the share', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await createLeaderShare(input);
    expect(builder.insert).toHaveBeenCalledWith([input]);
  });

  it('raises a friendly error on a duplicate sharing relationship (23505)', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: { code: '23505' } }));
    await expect(createLeaderShare(input)).rejects.toThrow('This sharing relationship already exists');
  });

  it('rethrows other errors as-is', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(createLeaderShare(input)).rejects.toEqual(error);
  });
});

describe('deleteLeaderShare', () => {
  it('deletes by id', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await deleteLeaderShare('s1');
    expect(builder.eq).toHaveBeenCalledWith('id', 's1');
  });

  it('throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(deleteLeaderShare('s1')).rejects.toEqual(error);
  });
});
