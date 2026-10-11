import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeQueryBuilder, type MockQueryBuilder } from './supabaseMock';

vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: {}, from: vi.fn() } }));

import { verifyAdminCaller } from '../adminCallerService';

const jwt = (aal: string) => `h.${Buffer.from(JSON.stringify({ aal })).toString('base64url')}.s`;

function setup(opts: { user?: { id: string } | null; profile?: { name: string; state: string } | null; leaders?: { leader: string; admin: string | null }[] } = {}) {
  const builders: Record<string, MockQueryBuilder> = {
    user_profiles: makeQueryBuilder({ data: opts.profile === undefined ? { name: 'Peter_AD', state: 'vic' } : opts.profile, error: null }),
    state_leaders: makeQueryBuilder({ data: opts.leaders ?? [{ leader: 'Peter_AD', admin: 'AD' }, { leader: 'Peter', admin: null }], error: null }),
  };
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: opts.user === undefined ? { id: 'u1' } : opts.user }, error: null }) },
    from: vi.fn((t: string) => builders[t]),
  } as unknown as SupabaseClient;
  return client;
}

describe('verifyAdminCaller', () => {
  it('accepts a full admin at aal2', async () => {
    expect(await verifyAdminCaller(setup(), jwt('aal2'))).toEqual({ ok: true, userId: 'u1', label: 'Peter_AD (VIC)' });
  });

  it('rejects an invalid token', async () => {
    expect(await verifyAdminCaller(setup({ user: null }), jwt('aal2'))).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects an admin whose session is not at aal2', async () => {
    expect(await verifyAdminCaller(setup(), jwt('aal1'))).toMatchObject({ ok: false, status: 403 });
  });

  it('rejects a state reporter (SR is not a full admin)', async () => {
    const client = setup({ profile: { name: 'Peter_SR', state: 'VIC' }, leaders: [{ leader: 'Peter_SR', admin: 'SR' }] });
    expect(await verifyAdminCaller(client, jwt('aal2'))).toMatchObject({ ok: false, status: 403 });
  });

  it('rejects a plain leader and a session with no profile', async () => {
    expect(await verifyAdminCaller(setup({ profile: { name: 'Peter', state: 'VIC' } }), jwt('aal2'))).toMatchObject({ ok: false, status: 403 });
    expect(await verifyAdminCaller(setup({ profile: null }), jwt('aal2'))).toMatchObject({ ok: false, status: 403 });
  });

  it('matches the name exactly, not as a LIKE pattern (an underscore must not act as a wildcard)', async () => {
    // "PeterXAD" would match "Peter_AD" under ILIKE; it must not here.
    const client = setup({ profile: { name: 'PeterXAD', state: 'VIC' } });
    expect(await verifyAdminCaller(client, jwt('aal2'))).toMatchObject({ ok: false, status: 403 });
  });
});
