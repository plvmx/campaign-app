import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

const mockGetSession = vi.fn();
const mockGetUser = vi.fn();
const mockSignOut = vi.fn();
vi.mock('../supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: (...a: unknown[]) => mockGetSession(...a),
      getUser: (...a: unknown[]) => mockGetUser(...a),
      signOut: (...a: unknown[]) => mockSignOut(...a),
    },
    from: vi.fn(),
  },
}));

import { getVerifiedSession } from '../auth';

const SESSION = { access_token: 't', user: { id: 'u1' } };

beforeEach(() => {
  mockGetSession.mockReset().mockResolvedValue({ data: { session: SESSION }, error: null });
  mockGetUser.mockReset();
  mockSignOut.mockReset().mockResolvedValue({ error: null });
  document.cookie = 'app_session=1; path=/';
});

describe('getVerifiedSession', () => {
  it('returns null without asking the server when nothing is saved', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    expect(await getVerifiedSession()).toBeNull();
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('returns the session when the server still accepts it', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    expect(await getVerifiedSession()).toBe(SESSION);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('clears a session the server rejects (e.g. a banned account) from this device', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError('User is banned', 403, 'user_banned') });
    expect(await getVerifiedSession()).toBeNull();
    expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(document.cookie).not.toContain('app_session=1');
  });

  it('returns null but keeps the session when the server cannot be reached', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) });
    expect(await getVerifiedSession()).toBeNull();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(document.cookie).toContain('app_session=1');
  });
});
