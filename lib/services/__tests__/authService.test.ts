import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), auth: { getUser: vi.fn() } },
}));

import { supabase } from '@/lib/supabaseClient';
import { makeQueryBuilder } from './supabaseMock';
import { getAuthenticatedUser } from '../authService';

const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;
const mockGetUser = vi.mocked(supabase.auth.getUser);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getAuthenticatedUser', () => {
  it('returns null when there is no signed-in user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null } as never);
    expect(await getAuthenticatedUser()).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('throws when the auth check itself errors', async () => {
    const error = { message: 'network error' };
    mockGetUser.mockResolvedValue({ data: { user: null }, error } as never);
    await expect(getAuthenticatedUser()).rejects.toEqual(error);
  });

  it('returns a null-role shape when the profile has no name/state yet', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } }, error: null } as never);
    mockFrom.mockReturnValue(makeQueryBuilder({ data: { name: null, state: null }, error: null }));

    const result = await getAuthenticatedUser();

    expect(result).toEqual({
      user: { id: 'u1', email: 'a@b.com' },
      profile: { name: null, state: null },
      adminStatus: null,
      isAdmin: false,
      userState: null,
      userLeader: null,
      userMobile: null,
    });
  });

  it('tolerates a missing profile row (PGRST116) rather than throwing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null } as never);
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: { code: 'PGRST116' } }));

    const result = await getAuthenticatedUser();
    expect(result?.profile).toBeNull();
    expect(result?.adminStatus).toBeNull();
  });

  it('throws on a real profile-query error', async () => {
    const error = { code: '500', message: 'boom' };
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null } as never);
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(getAuthenticatedUser()).rejects.toEqual(error);
  });

  it('resolves full admin status from the matching state_leaders row', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } }, error: null } as never);
    mockFrom
      .mockReturnValueOnce(makeQueryBuilder({ data: { name: '  Alice  ', state: 'vic' }, error: null }))
      .mockReturnValueOnce(
        makeQueryBuilder({ data: [{ admin: 'AD', leader: 'Alice', state: 'VIC', mobile: '0412345678' }], error: null }),
      );

    const result = await getAuthenticatedUser();

    expect(result).toEqual({
      user: { id: 'u1', email: 'a@b.com' },
      profile: { name: '  Alice  ', state: 'vic' },
      adminStatus: 'AD',
      isAdmin: true,
      userState: 'VIC',
      userLeader: 'Alice',
      userMobile: '0412345678',
    });
  });

  it('is not admin for a state reporter (isAdmin only true for AD)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null } as never);
    mockFrom
      .mockReturnValueOnce(makeQueryBuilder({ data: { name: 'Bob', state: 'NSW' }, error: null }))
      .mockReturnValueOnce(
        makeQueryBuilder({ data: [{ admin: 'SR', leader: 'Bob', state: 'NSW', mobile: null }], error: null }),
      );

    const result = await getAuthenticatedUser();
    expect(result?.adminStatus).toBe('SR');
    expect(result?.isAdmin).toBe(false);
  });

  it('falls back to the normalized profile state when no state_leaders row matches', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null } as never);
    mockFrom
      .mockReturnValueOnce(makeQueryBuilder({ data: { name: 'Nobody', state: 'qld' }, error: null }))
      .mockReturnValueOnce(makeQueryBuilder({ data: [], error: null }));

    const result = await getAuthenticatedUser();
    expect(result?.adminStatus).toBeNull();
    expect(result?.userState).toBe('QLD');
    expect(result?.userLeader).toBeNull();
  });
});
