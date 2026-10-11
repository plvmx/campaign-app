import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeQueryBuilder, type MockQueryBuilder } from './supabaseMock';
import { completeMfaEnrollment, escapeLikePattern } from '../mfaEnrollmentService';

function makeClient(result: { data: unknown; error: unknown; count?: number | null }): { client: SupabaseClient; builder: MockQueryBuilder } {
  const builder = makeQueryBuilder(result as { data: unknown; error: unknown });
  const client = { from: vi.fn(() => builder) } as unknown as SupabaseClient;
  return { client, builder };
}

describe('escapeLikePattern', () => {
  it('escapes % and _ so an address matches literally', () => {
    expect(escapeLikePattern('a_b%c@x.com')).toBe('a\\_b\\%c@x.com');
  });
  it('leaves an ordinary address alone', () => {
    expect(escapeLikePattern('lorraine@x.com')).toBe('lorraine@x.com');
  });
});

describe('completeMfaEnrollment', () => {
  it('binds still-unbound rows with the proven email (marking them confirmed), then stamps every bound row enrolled', async () => {
    const { client, builder } = makeClient({ data: null, error: null, count: 3 });

    const result = await completeMfaEnrollment(client, { userId: 'user-1', email: 'Lorraine_W@Outlook.com' });

    expect(result).toEqual({ ok: true, enrolledRows: 3 });
    expect(builder.update).toHaveBeenNthCalledWith(1, { user_id: 'user-1', email_confirmed_at: expect.any(String) });
    expect(builder.is).toHaveBeenCalledWith('user_id', null);
    // the underscore is escaped, so it can't wildcard-match a different address
    expect(builder.ilike).toHaveBeenCalledWith('email', 'Lorraine\\_W@Outlook.com');
    expect(builder.update).toHaveBeenNthCalledWith(2, { mfa_enrolled_at: expect.any(String) }, { count: 'exact' });
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('only ever binds rows whose user_id is null — never takes over a row bound to another account', async () => {
    const { client, builder } = makeClient({ data: null, error: null, count: 1 });
    await completeMfaEnrollment(client, { userId: 'user-1', email: 'a@x.com' });
    expect(builder.is).toHaveBeenCalledWith('user_id', null);
  });

  it('skips binding when the session has no email, but still stamps rows already bound to it', async () => {
    const { client, builder } = makeClient({ data: null, error: null, count: 1 });
    const result = await completeMfaEnrollment(client, { userId: 'user-1', email: null });

    expect(result).toEqual({ ok: true, enrolledRows: 1 });
    expect(builder.ilike).not.toHaveBeenCalled();
    expect(builder.update).toHaveBeenCalledTimes(1);
  });

  it('returns 404 rather than success when no row ends up bound to the account', async () => {
    const { client } = makeClient({ data: null, error: null, count: 0 });
    const result = await completeMfaEnrollment(client, { userId: 'user-1', email: 'nobody@x.com' });
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('returns 500 when a write errors', async () => {
    const { client } = makeClient({ data: null, error: { message: 'boom' }, count: null });
    const result = await completeMfaEnrollment(client, { userId: 'user-1', email: 'a@x.com' });
    expect(result).toMatchObject({ ok: false, status: 500 });
  });
});
