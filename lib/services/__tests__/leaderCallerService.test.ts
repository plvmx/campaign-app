import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: {}, from: vi.fn() } }));

import { getLeaderCaller } from '../leaderCallerService';
import { makeQueryBuilder } from './supabaseMock';

function makeClient(opts: {
  user?: { id: string } | null;
  profile?: { name: string | null; state: string | null } | null;
  leaders?: unknown[];
  shares?: unknown[];
}) {
  const tables: Record<string, unknown> = {
    user_profiles: opts.profile === undefined ? { name: 'Jane Smith', state: 'vic' } : opts.profile,
    state_leaders: opts.leaders ?? [{ leader: 'Jane Smith', mobile: '0400123456', admin: null }],
    leader_shares: opts.shares ?? [],
  };
  const from = vi.fn((table: string) => makeQueryBuilder({ data: tables[table], error: null }));
  const getUser = vi.fn().mockResolvedValue(
    opts.user === null ? { data: { user: null }, error: { message: 'bad' } } : { data: { user: opts.user ?? { id: 'u1' } }, error: null },
  );
  return { client: { from, auth: { getUser } } as unknown as SupabaseClient, from };
}

describe('getLeaderCaller', () => {
  it('rejects a token that does not belong to a user', async () => {
    const { client } = makeClient({ user: null });
    await expect(getLeaderCaller(client, 't')).resolves.toEqual({ ok: false, status: 401, error: 'Unauthorized' });
  });

  it('rejects a session with no profile, or whose profile matches no leader', async () => {
    await expect(getLeaderCaller(makeClient({ profile: null }).client, 't')).resolves.toMatchObject({ ok: false, status: 403 });
    await expect(getLeaderCaller(makeClient({ profile: { name: 'Nobody', state: 'VIC' } }).client, 't'))
      .resolves.toMatchObject({ ok: false, status: 403 });
  });

  it('returns the leader\'s role, state, name and mobile from their state_leaders row', async () => {
    const { client } = makeClient({ leaders: [{ leader: 'Jane Smith', mobile: '0400123456', admin: 'SR' }, { leader: 'Other', mobile: null, admin: 'AD' }] });
    await expect(getLeaderCaller(client, 't')).resolves.toEqual({
      ok: true,
      userId: 'u1',
      caller: { adminStatus: 'SR', state: 'VIC', leader: 'Jane Smith', mobile: '0400123456' },
      sharedWithMeOwners: [],
    });
  });

  it('returns only the campaigns shared with this leader', async () => {
    const { client } = makeClient({
      shares: [
        { owner_state: 'VIC', owner_leader: 'Pat', shared_with_leader: ' jane smith ' },
        { owner_state: 'VIC', owner_leader: 'Sam', shared_with_leader: 'Someone Else' },
      ],
    });
    const result = await getLeaderCaller(client, 't');
    expect(result.ok && result.sharedWithMeOwners).toEqual([{ owner_state: 'VIC', owner_leader: 'Pat' }]);
  });
});
