import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Permission } from '../permissions';

// Mock supabase and auth before importing the module under test
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}));

vi.mock('../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth')>();
  return {
    ...actual,
    getCurrentUser: vi.fn(),
  };
});

import { getUserRole } from '../permissions';
import { supabase } from '../supabaseClient';
import { getCurrentUser } from '../auth';

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockFrom = vi.mocked(supabase.from);

function mockProfileQuery(name: string | null, state: string | null) {
  mockFrom.mockImplementationOnce(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: name && state ? { name, state } : null,
      error: null,
    }),
  }) as never);
}

function mockLeaderQuery(admin: string | null) {
  mockFrom.mockImplementationOnce(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockResolvedValue({
      data: admin !== undefined ? [{ admin, leader: 'testleader' }] : [],
      error: null,
    }),
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentUser.mockResolvedValue({ id: 'user-123' });
});

describe('getUserRole', () => {
  it('throws when user is not authenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    await expect(getUserRole()).rejects.toThrow('User not authenticated');
  });

  it('returns admin role when state_leaders admin field is AD', async () => {
    mockProfileQuery('peter', 'VIC');
    mockLeaderQuery('AD');

    const role = await getUserRole();
    expect(role.role).toBe('admin');
    expect(role.permissions).toContain(Permission.ADMIN_ACCESS);
  });

  it('returns user role when state_leaders admin field is not AD', async () => {
    mockProfileQuery('jane', 'NSW');
    mockLeaderQuery('SR');

    const role = await getUserRole();
    expect(role.role).toBe('user');
    expect(role.permissions).not.toContain(Permission.ADMIN_ACCESS);
  });

  it('returns user role when no matching state_leaders record exists', async () => {
    mockProfileQuery('nobody', 'QLD');
    mockFrom.mockImplementationOnce(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockResolvedValue({ data: [], error: null }),
    }) as never);

    const role = await getUserRole();
    expect(role.role).toBe('user');
  });

  it('returns user role when profile is missing', async () => {
    mockProfileQuery(null, null);

    const role = await getUserRole();
    expect(role.role).toBe('user');
  });

  it('admin role includes all campaign permissions', async () => {
    mockProfileQuery('admin', 'VIC');
    mockLeaderQuery('AD');

    const role = await getUserRole();
    expect(role.permissions).toContain(Permission.VIEW_CAMPAIGNS);
    expect(role.permissions).toContain(Permission.CREATE_CAMPAIGN);
    expect(role.permissions).toContain(Permission.EDIT_CAMPAIGN);
    expect(role.permissions).toContain(Permission.DELETE_CAMPAIGN);
    expect(role.permissions).toContain(Permission.VIEW_RESULTS);
  });

  it('user role excludes delete and admin permissions', async () => {
    mockProfileQuery('jane', 'NSW');
    mockLeaderQuery(null);

    const role = await getUserRole();
    expect(role.permissions).not.toContain(Permission.DELETE_CAMPAIGN);
    expect(role.permissions).not.toContain(Permission.ADMIN_ACCESS);
  });
});
