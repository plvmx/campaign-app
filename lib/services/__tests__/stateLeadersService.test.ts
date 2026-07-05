import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), auth: {} },
}));

import { supabase } from '@/lib/supabaseClient';
import { makeQueryBuilder } from './supabaseMock';
import { getStateLeaders, createStateLeader, updateStateLeader, deleteStateLeader } from '../stateLeadersService';

const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getStateLeaders', () => {
  it('returns all leaders when no state filter is given', async () => {
    const builder = makeQueryBuilder({ data: [{ id: '1', state: 'VIC', leader: 'Alice', mobile: null, admin: null, created_at: '' }], error: null });
    mockFrom.mockReturnValue(builder);
    const result = await getStateLeaders();
    expect(result).toHaveLength(1);
    expect(builder.eq).not.toHaveBeenCalled();
  });

  it('filters by state when given one', async () => {
    const builder = makeQueryBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await getStateLeaders('VIC');
    expect(builder.eq).toHaveBeenCalledWith('state', 'VIC');
  });

  it('throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(getStateLeaders()).rejects.toEqual(error);
  });
});

describe('createStateLeader', () => {
  it('inserts the leader', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    const input = { state: 'VIC', leader: 'Alice', mobile: '0412345678', admin: null };
    await createStateLeader(input);
    expect(builder.insert).toHaveBeenCalledWith([input]);
  });

  it('raises a friendly error on a duplicate state+leader (23505)', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: { code: '23505' } }));
    await expect(
      createStateLeader({ state: 'VIC', leader: 'Alice', mobile: null, admin: null }),
    ).rejects.toThrow('This state-leader combination already exists');
  });

  it('rethrows other errors as-is', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(
      createStateLeader({ state: 'VIC', leader: 'Alice', mobile: null, admin: null }),
    ).rejects.toEqual(error);
  });
});

describe('updateStateLeader', () => {
  it('updates by id', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    const input = { state: 'VIC', leader: 'Alice', mobile: null, admin: 'SR' };
    await updateStateLeader('l1', input);
    expect(builder.update).toHaveBeenCalledWith(input);
    expect(builder.eq).toHaveBeenCalledWith('id', 'l1');
  });

  it('throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(
      updateStateLeader('l1', { state: 'VIC', leader: 'Alice', mobile: null, admin: null }),
    ).rejects.toEqual(error);
  });
});

describe('deleteStateLeader', () => {
  it('deletes by id', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await deleteStateLeader('l1');
    expect(builder.eq).toHaveBeenCalledWith('id', 'l1');
  });

  it('throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(deleteStateLeader('l1')).rejects.toEqual(error);
  });
});
