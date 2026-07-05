import { describe, it, expect, vi, beforeEach } from 'vitest';

// Prevent supabaseClient from requiring real env vars at import time
vi.mock('../supabaseClient', () => ({
  supabase: { auth: {}, from: vi.fn() },
}));
vi.mock('../userProfile', () => ({
  getUserProfile: vi.fn(),
}));

import { supabase } from '../supabaseClient';
import { getUserProfile } from '../userProfile';
import { makeQueryBuilder } from '../services/__tests__/supabaseMock';
import { isRecognizedAdminStatus, getUserAdminStatusAndMobile } from '../campaignFilter';

const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;
const mockGetUserProfile = vi.mocked(getUserProfile);

// Regression coverage for #78: login's post-sign-in chooser used
// `if (!match.admin)`, a truthy check, so any non-empty junk value in the
// `admin` column (e.g. a recruiter's name) was treated as "is admin" and
// routed the leader into the wrong post-login flow. isRecognizedAdminStatus
// must only ever recognize the exact 'AD' / 'SR' status codes.
describe('isRecognizedAdminStatus', () => {
  it('recognizes full admin', () => {
    expect(isRecognizedAdminStatus('AD')).toBe(true);
  });

  it('recognizes state reporter', () => {
    expect(isRecognizedAdminStatus('SR')).toBe(true);
  });

  it('rejects null', () => {
    expect(isRecognizedAdminStatus(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isRecognizedAdminStatus(undefined)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isRecognizedAdminStatus('')).toBe(false);
  });

  it('rejects stray legacy data such as a recruiter\'s name (the #78 case)', () => {
    expect(isRecognizedAdminStatus('Lorraine')).toBe(false);
  });

  it('rejects lowercase variants — comparison is exact, not case-insensitive', () => {
    expect(isRecognizedAdminStatus('ad')).toBe(false);
    expect(isRecognizedAdminStatus('sr')).toBe(false);
  });
});

describe('getUserAdminStatusAndMobile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns nulls when the user has no profile name or state', async () => {
    mockGetUserProfile.mockResolvedValue(null);
    const result = await getUserAdminStatusAndMobile();
    expect(result).toEqual({ admin: null, state: null, mobile: null, leader: null });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('looks up the matching leader by normalized name and uppercased state', async () => {
    mockGetUserProfile.mockResolvedValue({ name: '  Alice  ', state: 'vic' } as never);
    const builder = makeQueryBuilder({
      data: [{ admin: 'SR', leader: 'Alice', state: 'VIC', mobile: '0412345678' }],
      error: null,
    });
    mockFrom.mockReturnValue(builder);

    const result = await getUserAdminStatusAndMobile();

    expect(builder.eq).toHaveBeenCalledWith('state', 'VIC');
    expect(builder.ilike).toHaveBeenCalledWith('leader', 'alice');
    expect(result).toEqual({ admin: 'SR', state: 'VIC', mobile: '0412345678', leader: 'Alice' });
  });

  it('returns nulls (but keeps the normalized state) when no leader row matches', async () => {
    mockGetUserProfile.mockResolvedValue({ name: 'Nobody', state: 'VIC' } as never);
    mockFrom.mockReturnValue(makeQueryBuilder({ data: [], error: null }));
    const result = await getUserAdminStatusAndMobile();
    expect(result).toEqual({ admin: null, state: 'VIC', mobile: null, leader: null });
  });

  it('falls back to nulls (not a throw) when the state_leaders query errors', async () => {
    mockGetUserProfile.mockResolvedValue({ name: 'Alice', state: 'VIC' } as never);
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: { message: 'db down' } }));
    const result = await getUserAdminStatusAndMobile();
    expect(result).toEqual({ admin: null, state: 'VIC', mobile: null, leader: null });
  });

  it('treats a stray non-code value in admin the same as a real status — callers must use isRecognizedAdminStatus', async () => {
    mockGetUserProfile.mockResolvedValue({ name: 'Lorraine', state: 'NSW' } as never);
    mockFrom.mockReturnValue(
      makeQueryBuilder({ data: [{ admin: 'Lorraine', leader: 'Lorraine', state: 'NSW', mobile: null }], error: null }),
    );
    const result = await getUserAdminStatusAndMobile();
    // This function only looks up the raw column value — it does not classify it.
    // #78 happened because a caller treated this raw string as a boolean instead
    // of passing it through isRecognizedAdminStatus().
    expect(result.admin).toBe('Lorraine');
    expect(isRecognizedAdminStatus(result.admin)).toBe(false);
  });
});
