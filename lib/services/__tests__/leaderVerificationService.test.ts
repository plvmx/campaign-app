import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: { from: vi.fn() },
}));
// findVerifiedStateLeaders imports normalizeMobile/normalizeName from
// lib/auth.ts, which also creates the browser supabase client at import
// time — mock it out so that doesn't require real env vars in tests (same
// convention as lib/__tests__/auth.test.ts).
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: {}, from: vi.fn() },
}));

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { makeQueryBuilder } from './supabaseMock';
import { findVerifiedStateLeaders } from '../leaderVerificationService';

const mockFrom = vi.mocked(supabaseAdmin.from) as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

const rosheen = {
  id: 'l1', state: 'VIC', leader: 'Rosheen', mobile: '0412345678', admin: null,
  email: null, pending_email: null, mfa_enrolled_at: null,
};

describe('findVerifiedStateLeaders', () => {
  it('returns the match on an exact name + mobile match', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: [rosheen], error: null }));
    const result = await findVerifiedStateLeaders('0412345678', 'Rosheen');
    expect(result).toEqual([rosheen]);
  });

  it('passes mfa_enrolled_at through untouched when set', async () => {
    const enrolled = { ...rosheen, mfa_enrolled_at: '2026-09-01T00:00:00Z' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: [enrolled], error: null }));
    const result = await findVerifiedStateLeaders('0412345678', 'Rosheen');
    expect(result).toEqual([enrolled]);
  });

  it('rejects a name-prefix-only match — "Rosh" must not match "Rosheen"', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: [rosheen], error: null }));
    const result = await findVerifiedStateLeaders('0412345678', 'Rosh');
    expect(result).toEqual([]);
  });

  it('rejects a mobile mismatch even with an exact name match', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: [rosheen], error: null }));
    const result = await findVerifiedStateLeaders('0499999999', 'Rosheen');
    expect(result).toEqual([]);
  });

  it('rejects a record with no mobile on file', async () => {
    const noMobile = { ...rosheen, mobile: null };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: [noMobile], error: null }));
    const result = await findVerifiedStateLeaders('0412345678', 'Rosheen');
    expect(result).toEqual([]);
  });

  it('returns an empty array when mobile or name is blank, without querying', async () => {
    const result = await findVerifiedStateLeaders('', 'Rosheen');
    expect(result).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('throws on a database error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(findVerifiedStateLeaders('0412345678', 'Rosheen')).rejects.toEqual(error);
  });
});
