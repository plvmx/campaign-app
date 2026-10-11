import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeQueryBuilder, type MockQueryBuilder } from './supabaseMock';
import { resetLeaderMfa } from '../mfaResetService';

function setup(opts: {
  target?: { id: string; user_id: string | null } | null;
  factors?: { id: string }[];
  listError?: unknown;
  deleteError?: unknown;
  auditError?: unknown;
  count?: number;
} = {}) {
  const target = opts.target === undefined ? { id: 'sl-1', user_id: 'target-user' } : opts.target;
  const builders: Record<string, MockQueryBuilder> = {
    state_leaders: makeQueryBuilder({ data: target, error: null, count: opts.count ?? 2 } as { data: unknown; error: unknown }),
    user_profiles: makeQueryBuilder({ data: null, error: null }),
    user_roles: makeQueryBuilder({ data: null, error: null }),
    state_leader_mfa_resets: makeQueryBuilder({ data: null, error: opts.auditError ?? null }),
  };
  const listFactors = vi.fn().mockResolvedValue({ data: { factors: opts.factors ?? [{ id: 'f1' }] }, error: opts.listError ?? null });
  const deleteFactor = vi.fn().mockResolvedValue({ data: {}, error: opts.deleteError ?? null });
  const client = {
    from: vi.fn((t: string) => builders[t]),
    auth: { admin: { mfa: { listFactors, deleteFactor } } },
  } as unknown as SupabaseClient;
  return { client, builders, listFactors, deleteFactor };
}

const params = { leaderId: 'sl-1', actorUserId: 'admin-user', actorLabel: 'Peter_AD (VIC)' };

describe('resetLeaderMfa', () => {
  it('deletes every factor, clears mfa_enrolled_at on all the account\'s rows, ends the app session, and audits', async () => {
    const { client, builders, listFactors, deleteFactor } = setup({ factors: [{ id: 'f1' }, { id: 'f2' }], count: 3 });

    const result = await resetLeaderMfa(client, params);

    expect(result).toEqual({ ok: true, factorsRemoved: 2, rowsReset: 3 });
    expect(listFactors).toHaveBeenCalledWith({ userId: 'target-user' });
    expect(deleteFactor).toHaveBeenCalledWith({ id: 'f1', userId: 'target-user' });
    expect(deleteFactor).toHaveBeenCalledWith({ id: 'f2', userId: 'target-user' });
    expect(builders.state_leaders.update).toHaveBeenCalledWith({ mfa_enrolled_at: null }, { count: 'exact' });
    expect(builders.state_leaders.eq).toHaveBeenCalledWith('user_id', 'target-user');
    expect(builders.user_profiles.delete).toHaveBeenCalled();
    expect(builders.user_roles.delete).toHaveBeenCalled();
    expect(builders.state_leader_mfa_resets.insert).toHaveBeenCalledWith([
      { state_leader_id: 'sl-1', target_user_id: 'target-user', reset_by: 'Peter_AD (VIC)', reset_by_user_id: 'admin-user' },
    ]);
  });

  it('refuses to reset the caller\'s own 2FA, changing nothing', async () => {
    const { client, deleteFactor, builders } = setup({ target: { id: 'sl-1', user_id: 'admin-user' } });
    const result = await resetLeaderMfa(client, params);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(deleteFactor).not.toHaveBeenCalled();
    expect(builders.user_profiles.delete).not.toHaveBeenCalled();
  });

  it('returns 409 for a leader with no email sign-in account yet', async () => {
    const { client, deleteFactor } = setup({ target: { id: 'sl-1', user_id: null } });
    const result = await resetLeaderMfa(client, params);
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(deleteFactor).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown leader', async () => {
    const { client } = setup({ target: null });
    expect(await resetLeaderMfa(client, params)).toMatchObject({ ok: false, status: 404 });
  });

  it('fails (500) and does not clear enrolment if a factor cannot be deleted', async () => {
    const { client, builders } = setup({ deleteError: { message: 'boom' } });
    const result = await resetLeaderMfa(client, params);
    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(builders.state_leaders.update).not.toHaveBeenCalled();
  });

  it('still succeeds when the audit table is missing or the audit write fails', async () => {
    const { client } = setup({ auditError: { message: 'relation does not exist' } });
    expect(await resetLeaderMfa(client, params)).toMatchObject({ ok: true });
  });
});
