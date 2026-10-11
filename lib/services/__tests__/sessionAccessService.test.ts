import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeQueryBuilder, type MockQueryBuilder } from './supabaseMock';
import { getAalFromJwt, grantSessionAccess } from '../sessionAccessService';
import type { VerifiedStateLeaderRow } from '../leaderVerificationService';

// findVerifiedStateLeaders (and the supabase clients it imports) are replaced
// outright — it is injected per test, so these exercise only the grant
// decision + writes.
vi.mock('@/lib/services/leaderVerificationService', () => ({ findVerifiedStateLeaders: vi.fn() }));

const LEADER_AD: VerifiedStateLeaderRow = {
  id: 'sl-ad', state: 'VIC', leader: 'Peter_AD ', mobile: '0400000000', admin: 'AD',
  email: null, pending_email: null, mfa_enrolled_at: null,
};
const LEADER_PLAIN: VerifiedStateLeaderRow = { ...LEADER_AD, id: 'sl-plain', leader: 'Peter', admin: null };

let builders: Record<string, MockQueryBuilder>;
let client: SupabaseClient;

function makeClient(overrides: Record<string, MockQueryBuilder> = {}) {
  builders = {
    state_leaders: makeQueryBuilder({ data: null, error: null }),
    user_profiles: makeQueryBuilder({ data: null, error: null }),
    user_roles: makeQueryBuilder({ data: null, error: null }),
    ...overrides,
  };
  client = { from: vi.fn((table: string) => builders[table]) } as unknown as SupabaseClient;
}

const mobileName = (leaderId: string) => ({ method: 'mobile-name' as const, leaderId, mobile: '0400000000', firstName: 'Peter' });

describe('grantSessionAccess — mobile-name', () => {
  beforeEach(() => makeClient());

  it('writes the profile and grants admin for a verified AD leader', async () => {
    const result = await grantSessionAccess(client, {
      userId: 'user-1', aal: 'aal1', request: mobileName('sl-ad'),
      verifyLeaders: vi.fn().mockResolvedValue([LEADER_AD]),
    });

    expect(result).toEqual({ ok: true });
    expect(builders.user_profiles.upsert).toHaveBeenCalledWith(
      { user_id: 'user-1', name: 'Peter_AD', state: 'VIC' },
      { onConflict: 'user_id' },
    );
    expect(builders.user_roles.upsert).toHaveBeenCalledWith({ user_id: 'user-1', role: 'admin' }, { onConflict: 'user_id' });
    expect(builders.user_roles.delete).not.toHaveBeenCalled();
  });

  it('clears any admin role (instead of granting) for a verified non-AD leader', async () => {
    const result = await grantSessionAccess(client, {
      userId: 'user-1', aal: 'aal1', request: mobileName('sl-plain'),
      verifyLeaders: vi.fn().mockResolvedValue([LEADER_PLAIN]),
    });

    expect(result).toEqual({ ok: true });
    expect(builders.user_roles.delete).toHaveBeenCalled();
    expect(builders.user_roles.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(builders.user_roles.upsert).not.toHaveBeenCalled();
  });

  it('refuses, and writes nothing, when mobile+name matches no leader', async () => {
    const result = await grantSessionAccess(client, {
      userId: 'user-1', aal: 'aal1', request: mobileName('sl-ad'),
      verifyLeaders: vi.fn().mockResolvedValue([]),
    });

    expect(result).toEqual({ ok: false, status: 403, error: 'No matching leader found' });
    expect(builders.user_profiles.upsert).not.toHaveBeenCalled();
    expect(builders.user_roles.upsert).not.toHaveBeenCalled();
  });

  it('refuses a leaderId that is not one of the verified matches (cannot ask for a different leader\'s admin row)', async () => {
    const result = await grantSessionAccess(client, {
      userId: 'user-1', aal: 'aal1', request: mobileName('sl-ad'),
      verifyLeaders: vi.fn().mockResolvedValue([LEADER_PLAIN]),
    });

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(builders.user_roles.upsert).not.toHaveBeenCalled();
  });

  it('fails (500) rather than reporting success when the role write errors', async () => {
    makeClient({ user_roles: makeQueryBuilder({ data: null, error: { message: 'boom' } }) });
    const result = await grantSessionAccess(client, {
      userId: 'user-1', aal: 'aal1', request: mobileName('sl-ad'),
      verifyLeaders: vi.fn().mockResolvedValue([LEADER_AD]),
    });
    expect(result).toMatchObject({ ok: false, status: 500 });
  });
});

describe('grantSessionAccess — real-auth', () => {
  const realAuth = { method: 'real-auth' as const, leaderId: 'sl-ad' };

  it('grants when the session is the row\'s bound user and at aal2', async () => {
    makeClient({ state_leaders: makeQueryBuilder({ data: { leader: 'Peter_AD', state: 'VIC', admin: 'AD', user_id: 'user-1' }, error: null }) });
    const result = await grantSessionAccess(client, { userId: 'user-1', aal: 'aal2', request: realAuth });

    expect(result).toEqual({ ok: true });
    expect(builders.user_roles.upsert).toHaveBeenCalledWith({ user_id: 'user-1', role: 'admin' }, { onConflict: 'user_id' });
  });

  it('refuses a session that is not yet at aal2 (MFA not proven)', async () => {
    makeClient({ state_leaders: makeQueryBuilder({ data: { leader: 'Peter_AD', state: 'VIC', admin: 'AD', user_id: 'user-1' }, error: null }) });
    const result = await grantSessionAccess(client, { userId: 'user-1', aal: 'aal1', request: realAuth });

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(builders.user_roles.upsert).not.toHaveBeenCalled();
  });

  it('refuses a session whose user is not the row\'s bound user_id', async () => {
    makeClient({ state_leaders: makeQueryBuilder({ data: { leader: 'Peter_AD', state: 'VIC', admin: 'AD', user_id: 'someone-else' }, error: null }) });
    const result = await grantSessionAccess(client, { userId: 'user-1', aal: 'aal2', request: realAuth });

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(builders.user_roles.upsert).not.toHaveBeenCalled();
  });

  it('refuses an unknown leader row', async () => {
    makeClient({ state_leaders: makeQueryBuilder({ data: null, error: null }) });
    const result = await grantSessionAccess(client, { userId: 'user-1', aal: 'aal2', request: realAuth });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });
});

describe('getAalFromJwt', () => {
  const makeJwt = (payload: object) =>
    `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

  it('reads the aal claim', () => {
    expect(getAalFromJwt(makeJwt({ aal: 'aal2' }))).toBe('aal2');
    expect(getAalFromJwt(makeJwt({ aal: 'aal1' }))).toBe('aal1');
  });

  it('returns null when the claim is missing or the token is malformed', () => {
    expect(getAalFromJwt(makeJwt({ sub: 'x' }))).toBeNull();
    expect(getAalFromJwt('not-a-jwt')).toBeNull();
    expect(getAalFromJwt('a.%%%.c')).toBeNull();
  });
});
