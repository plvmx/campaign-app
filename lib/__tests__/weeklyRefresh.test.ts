import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabaseClient', () => ({
  supabase: { from: vi.fn(), auth: {} },
}));

import { supabase } from '../supabaseClient';
import { makeQueryBuilder } from '../services/__tests__/supabaseMock';
import {
  getLastWeeklyRefreshAt,
  getLeadersNotSignedInSinceRefresh,
  getLeadersNotSignedInSinceRefreshByState,
} from '../weeklyRefresh';

const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getLastWeeklyRefreshAt', () => {
  it('returns the most recent completed_at as a Date', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: { completed_at: '2026-08-10T01:00:00Z' }, error: null }));
    const result = await getLastWeeklyRefreshAt();
    expect(result).toEqual(new Date('2026-08-10T01:00:00Z'));
  });

  it('returns null when no refresh has ever been logged', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    expect(await getLastWeeklyRefreshAt()).toBeNull();
  });

  it('throws on error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = { message: 'db down' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(getLastWeeklyRefreshAt()).rejects.toEqual(error);
    consoleErrorSpy.mockRestore();
  });
});

describe('getLeadersNotSignedInSinceRefresh', () => {
  const leaders = [
    { id: '1', state: 'VIC', leader: 'Alice', mobile: null, admin: null, last_sign_in_at: '2026-08-11T00:00:00Z' }, // signed in after refresh
    { id: '2', state: 'VIC', leader: 'Bob', mobile: null, admin: null, last_sign_in_at: '2026-08-01T00:00:00Z' },   // signed in before refresh
    { id: '3', state: 'NSW', leader: 'Carl', mobile: null, admin: null, last_sign_in_at: null },                     // never signed in
  ];

  it('when a refresh has run, returns leaders who signed in before it or never', async () => {
    const refreshLogBuilder = makeQueryBuilder({ data: { completed_at: '2026-08-10T00:00:00Z' }, error: null });
    const leadersBuilder = makeQueryBuilder({ data: leaders, error: null });
    mockFrom.mockReturnValueOnce(refreshLogBuilder).mockReturnValueOnce(leadersBuilder);

    const result = await getLeadersNotSignedInSinceRefresh();

    expect(result.lastRefreshAt).toEqual(new Date('2026-08-10T00:00:00Z'));
    expect(result.leaders.map((l) => l.leader)).toEqual(['Bob', 'Carl']);
    expect(leadersBuilder.eq).not.toHaveBeenCalled(); // no state filter for the all-states variant
  });

  it('when no refresh has ever run, returns only leaders who have never signed in', async () => {
    const refreshLogBuilder = makeQueryBuilder({ data: null, error: null });
    const leadersBuilder = makeQueryBuilder({ data: leaders, error: null });
    mockFrom.mockReturnValueOnce(refreshLogBuilder).mockReturnValueOnce(leadersBuilder);

    const result = await getLeadersNotSignedInSinceRefresh();

    expect(result.lastRefreshAt).toBeNull();
    expect(result.leaders.map((l) => l.leader)).toEqual(['Carl']);
  });

  it('throws on a state_leaders query error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = { message: 'db down' };
    mockFrom
      .mockReturnValueOnce(makeQueryBuilder({ data: null, error: null }))
      .mockReturnValueOnce(makeQueryBuilder({ data: null, error }));
    await expect(getLeadersNotSignedInSinceRefresh()).rejects.toEqual(error);
    consoleErrorSpy.mockRestore();
  });
});

describe('getLeadersNotSignedInSinceRefreshByState', () => {
  it('returns [] without querying when state is blank', async () => {
    const result = await getLeadersNotSignedInSinceRefreshByState('   ');
    expect(result).toEqual({ leaders: [], lastRefreshAt: null });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('pushes the state filter down to the query instead of fetching every state', async () => {
    const refreshLogBuilder = makeQueryBuilder({ data: { completed_at: '2026-08-10T00:00:00Z' }, error: null });
    const leadersBuilder = makeQueryBuilder({
      data: [{ id: '2', state: 'VIC', leader: 'Bob', mobile: null, admin: null, last_sign_in_at: '2026-08-01T00:00:00Z' }],
      error: null,
    });
    mockFrom.mockReturnValueOnce(refreshLogBuilder).mockReturnValueOnce(leadersBuilder);

    const result = await getLeadersNotSignedInSinceRefreshByState('  vic ');

    expect(mockFrom).toHaveBeenNthCalledWith(2, 'state_leaders');
    expect(leadersBuilder.eq).toHaveBeenCalledWith('state', 'VIC');
    expect(result.leaders.map((l) => l.leader)).toEqual(['Bob']);
  });
});
