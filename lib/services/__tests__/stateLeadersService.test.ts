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
    const builder = makeQueryBuilder({ data: [{ id: '1', state: 'VIC', leader: 'Alice', mobile: null, admin: null, email: null, pending_email: null, email_confirmed_at: null, created_at: '' }], error: null });
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
    const builder = makeQueryBuilder({ data: { id: 'l1' }, error: null });
    mockFrom.mockReturnValue(builder);
    const input = { state: 'VIC', leader: 'Alice', mobile: '0412345678', admin: null, email: null };
    await createStateLeader(input);
    expect(builder.insert).toHaveBeenCalledWith([input]);
  });

  it('raises a friendly error on a duplicate state+leader (23505)', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: { code: '23505' } }));
    await expect(
      createStateLeader({ state: 'VIC', leader: 'Alice', mobile: null, admin: null, email: null }),
    ).rejects.toThrow('This state-leader combination already exists');
  });

  it('rethrows other errors as-is', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(
      createStateLeader({ state: 'VIC', leader: 'Alice', mobile: null, admin: null, email: null }),
    ).rejects.toEqual(error);
  });

  it('accepts AD and SR', async () => {
    const builder = makeQueryBuilder({ data: { id: 'l1' }, error: null });
    mockFrom.mockReturnValue(builder);
    await createStateLeader({ state: 'VIC', leader: 'Alice', mobile: null, admin: 'AD', email: null });
    await createStateLeader({ state: 'VIC', leader: 'Bob', mobile: null, admin: 'SR', email: null });
    expect(builder.insert).toHaveBeenCalledTimes(2);
  });

  it('rejects a non-AD/SR admin value without hitting the database — the #78 stray-value bug (a recruiter\'s name typed into this column)', async () => {
    const builder = makeQueryBuilder({ data: { id: 'l1' }, error: null });
    mockFrom.mockReturnValue(builder);
    await expect(
      createStateLeader({ state: 'WA', leader: 'Dena', mobile: null, admin: 'Lorraine', email: null }),
    ).rejects.toThrow('"Lorraine" is not a valid admin role — must be AD, SR, or left blank');
    expect(builder.insert).not.toHaveBeenCalled();
  });

  it('rejects lowercase variants — must be an exact match, same as isRecognizedAdminStatus', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: { id: 'l1' }, error: null }));
    await expect(
      createStateLeader({ state: 'VIC', leader: 'Alice', mobile: null, admin: 'ad', email: null }),
    ).rejects.toThrow('is not a valid admin role');
  });

  it('rejects a malformed email without hitting the database', async () => {
    const builder = makeQueryBuilder({ data: { id: 'l1' }, error: null });
    mockFrom.mockReturnValue(builder);
    await expect(
      createStateLeader({ state: 'VIC', leader: 'Alice', mobile: null, admin: null, email: 'not-an-email' }),
    ).rejects.toThrow('"not-an-email" is not a valid email address');
    expect(builder.insert).not.toHaveBeenCalled();
  });

  it('records an audit row (source: admin) when created with an email', async () => {
    const builder = makeQueryBuilder({ data: { id: 'l1' }, error: null });
    mockFrom.mockReturnValue(builder);
    await createStateLeader({ state: 'VIC', leader: 'Alice', mobile: null, admin: null, email: 'alice@example.com' });
    expect(builder.insert).toHaveBeenCalledWith([
      { state_leader_id: 'l1', old_email: null, new_email: 'alice@example.com', source: 'admin' },
    ]);
  });

  it('does not attempt an audit insert when no email is given', async () => {
    const builder = makeQueryBuilder({ data: { id: 'l1' }, error: null });
    mockFrom.mockReturnValue(builder);
    await createStateLeader({ state: 'VIC', leader: 'Alice', mobile: null, admin: null, email: null });
    expect(builder.insert).toHaveBeenCalledTimes(1); // the state_leaders insert only
  });

  it('does not fail the save if the audit insert fails', async () => {
    const stateLeadersBuilder = makeQueryBuilder({ data: { id: 'l1' }, error: null });
    const auditBuilder = makeQueryBuilder({ data: null, error: { code: '500', message: 'audit boom' } });
    mockFrom.mockImplementation((table: string) =>
      table === 'state_leader_email_changes' ? auditBuilder : stateLeadersBuilder,
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      createStateLeader({ state: 'VIC', leader: 'Alice', mobile: null, admin: null, email: 'alice@example.com' }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('still succeeds (creation was already committed) if the post-create id lookup for the audit fails', async () => {
    const builder = makeQueryBuilder({ data: null, error: null }); // insert succeeds
    builder.single.mockResolvedValueOnce({ data: null, error: { code: '500', message: 'lookup boom' } });
    mockFrom.mockReturnValue(builder);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      createStateLeader({ state: 'VIC', leader: 'Alice', mobile: null, admin: null, email: 'alice@example.com' }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('updateStateLeader', () => {
  it('updates by id', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    const input = { state: 'VIC', leader: 'Alice', mobile: null, admin: 'SR', email: null };
    await updateStateLeader('l1', input);
    expect(builder.update).toHaveBeenCalledWith(input);
    expect(builder.eq).toHaveBeenCalledWith('id', 'l1');
  });

  it('throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(
      updateStateLeader('l1', { state: 'VIC', leader: 'Alice', mobile: null, admin: null, email: null }),
    ).rejects.toEqual(error);
  });

  it('rejects a non-AD/SR admin value without hitting the database', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await expect(
      updateStateLeader('l1', { state: 'WA', leader: 'Dena', mobile: null, admin: 'Lorraine', email: null }),
    ).rejects.toThrow('is not a valid admin role');
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('rejects a malformed email without hitting the database', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await expect(
      updateStateLeader('l1', { state: 'VIC', leader: 'Alice', mobile: null, admin: null, email: 'not-an-email' }),
    ).rejects.toThrow('is not a valid email address');
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('does not record an audit row if the pre-update email fetch fails (avoids a false entry)', async () => {
    const stateLeadersBuilder = makeQueryBuilder({ data: null, error: null }); // update succeeds
    stateLeadersBuilder.single.mockResolvedValueOnce({ data: null, error: { code: '500', message: 'fetch boom' } });
    const auditBuilder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === 'state_leader_email_changes' ? auditBuilder : stateLeadersBuilder,
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await updateStateLeader('l1', { state: 'VIC', leader: 'Alice', mobile: null, admin: null, email: 'new@example.com' });

    expect(auditBuilder.insert).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('records an audit row (source: admin) when the email actually changes', async () => {
    const stateLeadersBuilder = makeQueryBuilder({ data: { email: 'old@example.com' }, error: null });
    const auditBuilder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === 'state_leader_email_changes' ? auditBuilder : stateLeadersBuilder,
    );

    await updateStateLeader('l1', { state: 'VIC', leader: 'Alice', mobile: null, admin: null, email: 'new@example.com' });

    expect(auditBuilder.insert).toHaveBeenCalledWith([
      { state_leader_id: 'l1', old_email: 'old@example.com', new_email: 'new@example.com', source: 'admin' },
    ]);
  });

  it('does not record an audit row on a no-op save (email unchanged)', async () => {
    const stateLeadersBuilder = makeQueryBuilder({ data: { email: 'same@example.com' }, error: null });
    const auditBuilder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === 'state_leader_email_changes' ? auditBuilder : stateLeadersBuilder,
    );

    await updateStateLeader('l1', { state: 'VIC', leader: 'Alice', mobile: null, admin: null, email: 'same@example.com' });

    expect(auditBuilder.insert).not.toHaveBeenCalled();
  });

  it('does not fail the save if the audit insert fails', async () => {
    const stateLeadersBuilder = makeQueryBuilder({ data: { email: 'old@example.com' }, error: null });
    const auditBuilder = makeQueryBuilder({ data: null, error: { code: '500', message: 'audit boom' } });
    mockFrom.mockImplementation((table: string) =>
      table === 'state_leader_email_changes' ? auditBuilder : stateLeadersBuilder,
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      updateStateLeader('l1', { state: 'VIC', leader: 'Alice', mobile: null, admin: null, email: 'new@example.com' }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
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
