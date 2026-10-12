/**
 * completeSignIn / completeLeaderAuthSignIn no longer write user_profiles or
 * user_roles from the browser — they ask /api/auth/grant-session-access to
 * (see lib/services/sessionAccessService.ts for why). These tests pin that:
 * the browser must never touch user_roles, and a refused grant must not
 * leave a half-signed-in session behind.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetSession = vi.fn();
const mockSignOut = vi.fn();
const mockSignInAnonymously = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: (...a: unknown[]) => mockGetSession(...a),
      signOut: (...a: unknown[]) => mockSignOut(...a),
      signInAnonymously: (...a: unknown[]) => mockSignInAnonymously(...a),
    },
    from: (...a: unknown[]) => mockFrom(...a),
  },
}));

import { completeSignIn, completeLeaderAuthSignIn, signOut, type StateLeaderMatch } from '../auth';

const MATCH: StateLeaderMatch = {
  id: 'sl-1', state: 'VIC', leader: 'Peter', mobile: null, admin: 'AD',
  email: null, pendingEmail: null, suggestedEmail: null, mfaEnrolledAt: null,
};
const CREDS = { mobile: '0400 000 000', firstName: 'Peter' };
const originalFetch = global.fetch;

describe('completeSignIn', () => {
  beforeEach(() => {
    mockSignOut.mockReset().mockResolvedValue({ error: null });
    mockSignInAnonymously.mockReset().mockResolvedValue({ data: { user: { id: 'anon-1' } }, error: null });
    // first call: stale-session check (none); second: token lookup after anon sign-in
    mockGetSession.mockReset()
      .mockResolvedValueOnce({ data: { session: null } })
      .mockResolvedValue({ data: { session: { access_token: 'tok-1' } } });
    const updateBuilder = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) };
    mockFrom.mockReset().mockReturnValue(updateBuilder);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  });
  afterEach(() => { global.fetch = originalFetch; });

  it('asks the server to grant access with the typed credentials and the new session token', async () => {
    await completeSignIn(MATCH, CREDS);

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/grant-session-access',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok-1' }),
        body: JSON.stringify({ method: 'mobile-name', leaderId: 'sl-1', mobile: '0400 000 000', firstName: 'Peter' }),
      }),
    );
  });

  it('never writes user_roles or user_profiles from the browser', async () => {
    await completeSignIn(MATCH, CREDS);
    const tables = mockFrom.mock.calls.map((c) => c[0]);
    expect(tables).not.toContain('user_roles');
    expect(tables).not.toContain('user_profiles');
  });

  it('signs out and throws if the server refuses, instead of leaving an un-roled anonymous session', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'No matching leader found' }) });

    await expect(completeSignIn(MATCH, CREDS)).rejects.toThrow(/could not be verified/i);
    expect(mockSignOut).toHaveBeenCalled();
  });
});

describe('completeSignIn — admin refusal', () => {
  beforeEach(() => {
    mockSignOut.mockReset().mockResolvedValue({ error: null });
    mockSignInAnonymously.mockReset().mockResolvedValue({ data: { user: { id: 'anon-1' } }, error: null });
    mockGetSession.mockReset()
      .mockResolvedValueOnce({ data: { session: null } })
      .mockResolvedValue({ data: { session: { access_token: 'tok-1' } } });
    mockFrom.mockReset();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 403,
      json: async () => ({ error: 'Admin accounts must sign in with email and two-factor authentication.', code: 'mfa_required' }),
    });
  });
  afterEach(() => { global.fetch = originalFetch; });

  it('surfaces the server\'s "admins must use email + 2FA" message and signs out', async () => {
    await expect(completeSignIn(MATCH, CREDS)).rejects.toThrow(/two-factor authentication/i);
    expect(mockSignOut).toHaveBeenCalled();
  });
});

describe('completeLeaderAuthSignIn', () => {
  beforeEach(() => {
    mockGetSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'tok-2' } } });
    const updateBuilder = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) };
    mockFrom.mockReset().mockReturnValue(updateBuilder);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  });
  afterEach(() => { global.fetch = originalFetch; });

  it('asks the server to grant the real-auth session, never writing user_roles itself', async () => {
    await completeLeaderAuthSignIn({ id: 'sl-1', state: 'VIC', leader: 'Peter', admin: 'AD' });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/grant-session-access',
      expect.objectContaining({ body: JSON.stringify({ method: 'real-auth', leaderId: 'sl-1' }) }),
    );
    expect(mockFrom.mock.calls.map((c) => c[0])).not.toContain('user_roles');
  });

  it('throws when the server refuses', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    await expect(completeLeaderAuthSignIn({ id: 'sl-1', state: 'VIC', leader: 'Peter', admin: 'AD' })).rejects.toThrow();
  });
});

describe('signing out clears the session\'s app identity', () => {
  beforeEach(() => {
    mockSignOut.mockReset().mockResolvedValue({ error: null });
    mockGetSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'tok-3' } } });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  });
  afterEach(() => { global.fetch = originalFetch; });

  it('asks the server to delete the profile/role rows, with the session token, before signing out', async () => {
    const order: string[] = [];
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => { order.push('revoke'); return { ok: true }; });
    mockSignOut.mockImplementation(async () => { order.push('signOut'); return { error: null }; });

    await signOut();

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/revoke-session-access',
      expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer tok-3' } }),
    );
    expect(order).toEqual(['revoke', 'signOut']);
  });

  it('still signs out if clearing the identity fails (best-effort)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));
    await expect(signOut()).resolves.toBeUndefined();
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('does not call the server when there is no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await signOut();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('also clears the old session\'s identity when a new login replaces it', async () => {
    mockSignInAnonymously.mockReset().mockResolvedValue({ data: { user: { id: 'anon-2' } }, error: null });
    const updateBuilder = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) };
    mockFrom.mockReset().mockReturnValue(updateBuilder);

    await completeSignIn({ id: 'sl-9', state: 'VIC', leader: 'Peter', mobile: null, admin: null, email: null, pendingEmail: null, suggestedEmail: null, mfaEnrolledAt: null }, CREDS);

    const urls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(urls[0]).toBe('/api/auth/revoke-session-access');
    expect(urls).toContain('/api/auth/grant-session-access');
  });
});
