import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeQueryBuilder, type MockQueryBuilder } from './supabaseMock';
import {
  checkRegistration,
  isSessionForStateLeader,
  normalizeNameForMatch,
  parseRegistrationCheckInput,
} from '../registrationCheckService';

type NameRow = { first_name: string | null; last_name: string | null };

/**
 * A fake registry client whose answer depends on which column the query
 * filtered on — email and phone lookups are separate queries, and the tests
 * need them to return different rows.
 */
function makeRegistryClient(rows: { email?: NameRow[]; phone?: NameRow[] }, error: unknown = null) {
  const builders: MockQueryBuilder[] = [];
  const from = vi.fn(() => {
    const builder = makeQueryBuilder<NameRow[] | null>({ data: null, error });
    let column: 'email' | 'phone' | null = null;
    builder.eq.mockImplementation((col: 'email' | 'phone') => {
      column = col;
      return builder;
    });
    builder.then = ((onfulfilled?: ((value: { data: unknown; error: unknown }) => unknown) | null) =>
      Promise.resolve({ data: error ? null : (column && rows[column]) ?? [], error }).then(
        onfulfilled ?? undefined,
      )) as MockQueryBuilder['then'];
    builders.push(builder);
    return builder;
  });
  const schema = vi.fn(() => ({ from }));
  return { client: { schema } as unknown as SupabaseClient, schema, from, builders };
}

const ALICE: NameRow = { first_name: 'Alice', last_name: 'Nguyen' };
const INPUT = { firstName: 'Alice', lastName: 'Nguyen', email: 'alice@example.com', mobile: '0412 345 678' };

describe('parseRegistrationCheckInput', () => {
  it('trims every field and turns a blank contact detail into null', () => {
    expect(
      parseRegistrationCheckInput({ firstName: ' Alice ', lastName: ' Nguyen ', email: ' alice@example.com ', mobile: '  ' }),
    ).toEqual({ ok: true, input: { firstName: 'Alice', lastName: 'Nguyen', email: 'alice@example.com', mobile: null } });
  });

  it('accepts a mobile with no email', () => {
    const parsed = parseRegistrationCheckInput({ firstName: 'Alice', lastName: 'Nguyen', mobile: '+61 412 345 678' });
    expect(parsed).toEqual({ ok: true, input: { firstName: 'Alice', lastName: 'Nguyen', email: null, mobile: '+61 412 345 678' } });
  });

  it('rejects a name-only request — a name alone must never search the registry', () => {
    expect(parseRegistrationCheckInput({ firstName: 'Alice', lastName: 'Nguyen', email: '', mobile: '' }).ok).toBe(false);
  });

  it.each([
    ['a missing first name', { firstName: '', lastName: 'Nguyen', email: 'a@b.co' }],
    ['a missing last name', { firstName: 'Alice', lastName: ' ', email: 'a@b.co' }],
    ['a malformed email', { firstName: 'Alice', lastName: 'Nguyen', email: 'not-an-email' }],
    ['a too-short mobile', { firstName: 'Alice', lastName: 'Nguyen', mobile: '0412' }],
    ['a too-long mobile', { firstName: 'Alice', lastName: 'Nguyen', mobile: '0412345678901234567' }],
    ['an over-long name', { firstName: 'A'.repeat(101), lastName: 'Nguyen', email: 'a@b.co' }],
    ['non-string fields', { firstName: 1, lastName: {}, email: ['a@b.co'] }],
    ['a non-object body', null],
  ])('rejects %s', (_label, body) => {
    expect(parseRegistrationCheckInput(body).ok).toBe(false);
  });
});

describe('normalizeNameForMatch', () => {
  it('ignores case, accents and extra spacing', () => {
    expect(normalizeNameForMatch('  José   DE la Cruz ')).toBe('jose de la cruz');
  });

  it('treats null/undefined as blank', () => {
    expect(normalizeNameForMatch(null)).toBe('');
    expect(normalizeNameForMatch(undefined)).toBe('');
  });
});

describe('checkRegistration', () => {
  it('is "registered" when the contact detail and the name both match', async () => {
    const { client } = makeRegistryClient({ email: [ALICE], phone: [ALICE] });
    expect(await checkRegistration(client, INPUT)).toEqual({ status: 'registered', matchedOn: ['email', 'mobile'] });
  });

  it('queries the registry schema by lower-cased email and E.164 phone, selecting names only', async () => {
    const { client, schema, from, builders } = makeRegistryClient({ email: [ALICE] });
    await checkRegistration(client, { ...INPUT, email: ' Alice@Example.COM ' });

    expect(schema).toHaveBeenCalledWith('registry');
    expect(from).toHaveBeenCalledWith('registrants');
    expect(builders).toHaveLength(2);
    expect(builders[0].eq).toHaveBeenCalledWith('email', 'alice@example.com');
    expect(builders[1].eq).toHaveBeenCalledWith('phone', '+61412345678');
    for (const builder of builders) {
      expect(builder.select).toHaveBeenCalledWith('first_name, last_name');
    }
  });

  it('matches names regardless of case, accents and spacing', async () => {
    const { client } = makeRegistryClient({ email: [{ first_name: ' JOSÉ ', last_name: 'de  la Cruz' }] });
    const result = await checkRegistration(client, { firstName: 'jose', lastName: 'De La Cruz', email: 'j@example.com', mobile: null });
    expect(result.status).toBe('registered');
  });

  it('reports only the contact detail that actually matched', async () => {
    const { client } = makeRegistryClient({ phone: [ALICE] });
    expect(await checkRegistration(client, INPUT)).toEqual({ status: 'registered', matchedOn: ['mobile'] });
  });

  it('is "name_mismatch" when the contact detail is on file under another name', async () => {
    const { client } = makeRegistryClient({ email: [{ first_name: 'Bao', last_name: 'Nguyen' }] });
    expect(await checkRegistration(client, INPUT)).toEqual({ status: 'name_mismatch', matchedOn: ['email'] });
  });

  it('is "name_mismatch" when the stored name is blank', async () => {
    const { client } = makeRegistryClient({ email: [{ first_name: null, last_name: null }] });
    expect((await checkRegistration(client, INPUT)).status).toBe('name_mismatch');
  });

  it('is "registered" when any one of several rows sharing a mobile has the name', async () => {
    const { client } = makeRegistryClient({ phone: [{ first_name: 'Bao', last_name: 'Nguyen' }, ALICE] });
    expect((await checkRegistration(client, { ...INPUT, email: null })).status).toBe('registered');
  });

  it('is "not_registered" when nothing matches', async () => {
    const { client } = makeRegistryClient({});
    expect(await checkRegistration(client, INPUT)).toEqual({ status: 'not_registered', matchedOn: [] });
  });

  it('skips the lookup for a contact detail that was not supplied', async () => {
    const { client, builders } = makeRegistryClient({ email: [ALICE] });
    await checkRegistration(client, { ...INPUT, mobile: null });
    expect(builders).toHaveLength(1);
    expect(builders[0].eq).toHaveBeenCalledWith('email', 'alice@example.com');
  });

  it('never returns anything stored in the registry', async () => {
    const { client } = makeRegistryClient({ email: [{ first_name: 'Bao', last_name: 'Tran' }] });
    const result = await checkRegistration(client, INPUT);
    expect(Object.keys(result).sort()).toEqual(['matchedOn', 'status']);
    expect(JSON.stringify(result)).not.toMatch(/Bao|Tran/);
  });

  it('throws on a query error rather than answering "not registered"', async () => {
    const { client } = makeRegistryClient({}, { message: 'permission denied for schema registry', code: '42501' });
    await expect(checkRegistration(client, INPUT)).rejects.toThrow(/permission denied.*42501/);
  });
});

describe('isSessionForStateLeader', () => {
  function makeClient(profile: unknown, leaders: unknown, errors: { profile?: unknown; leaders?: unknown } = {}) {
    const builders = {
      user_profiles: makeQueryBuilder({ data: profile, error: errors.profile ?? null }),
      state_leaders: makeQueryBuilder({ data: leaders, error: errors.leaders ?? null }),
    };
    const client = { from: vi.fn((table: keyof typeof builders) => builders[table]) } as unknown as SupabaseClient;
    return { client, builders };
  }

  it('is true when the session profile matches a state_leaders row', async () => {
    const { client, builders } = makeClient({ name: ' Peter ', state: 'vic' }, [{ id: 'sl-1' }]);

    expect(await isSessionForStateLeader(client, 'user-1')).toBe(true);
    expect(builders.user_profiles.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(builders.state_leaders.eq).toHaveBeenCalledWith('state', 'VIC');
    expect(builders.state_leaders.ilike).toHaveBeenCalledWith('leader', 'peter');
  });

  it('is false when no state_leaders row matches the profile', async () => {
    const { client } = makeClient({ name: 'Mallory', state: 'VIC' }, []);
    expect(await isSessionForStateLeader(client, 'user-1')).toBe(false);
  });

  it('is false — without querying state_leaders — for a session with no profile', async () => {
    const { client, builders } = makeClient(null, [{ id: 'sl-1' }]);
    expect(await isSessionForStateLeader(client, 'user-1')).toBe(false);
    expect(builders.state_leaders.select).not.toHaveBeenCalled();
  });

  it('is false for a profile with a blank name or state', async () => {
    const { client } = makeClient({ name: '  ', state: 'VIC' }, [{ id: 'sl-1' }]);
    expect(await isSessionForStateLeader(client, 'user-1')).toBe(false);
  });

  it('throws on a lookup error', async () => {
    const { client } = makeClient(null, null, { profile: { message: 'boom' } });
    await expect(isSessionForStateLeader(client, 'user-1')).rejects.toThrow(/boom/);
  });
});
