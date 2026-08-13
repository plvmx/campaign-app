import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabaseClient', () => ({
  supabase: { from: vi.fn() },
}));
vi.mock('../auth', () => ({
  getCurrentUser: vi.fn(),
}));
vi.mock('../userProfile', () => ({
  getUserProfile: vi.fn(),
}));

import { supabase } from '../supabaseClient';
import { getCurrentUser } from '../auth';
import { getUserProfile } from '../userProfile';
import { logResultsSave } from '../resultsLog';

const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;
const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockGetUserProfile = vi.mocked(getUserProfile);

/** Chainable insert-only fake — logResultsSave only ever calls .from('results_changes_log').insert({...}). */
function makeInsertBuilder() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  return { insert };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentUser.mockResolvedValue({ id: 'user-1', email: 'leader@example.com' });
  mockGetUserProfile.mockResolvedValue({
    id: 'profile-1', user_id: 'user-1', name: 'Alice', state: null,
    regular_place: null, regular_time: null, created_at: '', updated_at: '',
  });
});

describe('logResultsSave', () => {
  it('is a no-op — never calls Supabase — when both upserts and deletes are empty', () => {
    logResultsSave({ campaignId: 'c1', status: 'SUCCESS', attemptedUpserts: [], attemptedDeletes: [] });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('logs a SUCCESS save with the attempted upserts/deletes and resolved user identity', async () => {
    const builder = makeInsertBuilder();
    mockFrom.mockReturnValue(builder);

    logResultsSave({
      campaignId: 'c1',
      status: 'SUCCESS',
      attemptedUpserts: [{ first_name: 'Alice', category_code: 'TM' }],
      attemptedDeletes: [],
    });

    await vi.waitFor(() => expect(builder.insert).toHaveBeenCalled());

    expect(mockFrom).toHaveBeenCalledWith('results_changes_log');
    expect(builder.insert).toHaveBeenCalledWith({
      campaign_id: 'c1',
      user_id: 'user-1',
      status: 'SUCCESS',
      attempted_upserts: [{ first_name: 'Alice', category_code: 'TM' }],
      attempted_deletes: [],
      error_message: null,
      user_email: 'leader@example.com',
      user_name: 'Alice',
    });
  });

  it('logs an ERROR save with the error message', async () => {
    const builder = makeInsertBuilder();
    mockFrom.mockReturnValue(builder);

    logResultsSave({
      campaignId: 'c1',
      status: 'ERROR',
      attemptedUpserts: [{ first_name: 'Alice', category_code: 'TM' }],
      attemptedDeletes: [],
      errorMessage: 'check constraint violated',
    });

    await vi.waitFor(() => expect(builder.insert).toHaveBeenCalled());
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ERROR', error_message: 'check constraint violated' }),
    );
  });

  it('logs when there are only deletes and no upserts', async () => {
    const builder = makeInsertBuilder();
    mockFrom.mockReturnValue(builder);

    logResultsSave({
      campaignId: 'c1',
      status: 'SUCCESS',
      attemptedUpserts: [],
      attemptedDeletes: [{ first_name: 'Alice', category_code: 'TM' }],
    });

    await vi.waitFor(() => expect(builder.insert).toHaveBeenCalled());
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ attempted_deletes: [{ first_name: 'Alice', category_code: 'TM' }] }),
    );
  });

  it('never calls Supabase when there is no authenticated user', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    logResultsSave({
      campaignId: 'c1',
      status: 'SUCCESS',
      attemptedUpserts: [{ first_name: 'Alice', category_code: 'TM' }],
      attemptedDeletes: [],
    });
    await vi.waitFor(() => expect(mockGetCurrentUser).toHaveBeenCalled());
    // Give any (incorrect) follow-up microtask a chance to run before asserting the negative.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('still logs (with a null user_name) when the profile lookup throws', async () => {
    mockGetUserProfile.mockRejectedValue(new Error('profile fetch failed'));
    const builder = makeInsertBuilder();
    mockFrom.mockReturnValue(builder);

    logResultsSave({
      campaignId: 'c1',
      status: 'SUCCESS',
      attemptedUpserts: [{ first_name: 'Alice', category_code: 'TM' }],
      attemptedDeletes: [],
    });

    await vi.waitFor(() => expect(builder.insert).toHaveBeenCalled());
    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ user_name: null }));
  });

  it('never throws, even when the insert itself fails', async () => {
    const builder = { insert: vi.fn().mockResolvedValue({ error: { message: 'db down' } }) };
    mockFrom.mockReturnValue(builder);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() =>
      logResultsSave({
        campaignId: 'c1',
        status: 'SUCCESS',
        attemptedUpserts: [{ first_name: 'Alice', category_code: 'TM' }],
        attemptedDeletes: [],
      }),
    ).not.toThrow();

    await vi.waitFor(() => expect(builder.insert).toHaveBeenCalled());
    consoleErrorSpy.mockRestore();
  });
});
