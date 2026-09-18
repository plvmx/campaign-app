/**
 * Modeled directly on app/registry/auth/callback/__tests__/page.test.tsx —
 * this project's magic-link callback shape is the implicit #access_token=...
 * hash fragment, not ?code= (confirmed live for /registry; see that test's
 * own header comment and lib/registrySupabaseClient.ts). This page relies
 * on the same detectSessionInUrl + SIGNED_IN-event pattern
 * (lib/emailConfirmSupabaseClient.ts), so it needs the same regression
 * coverage: never parse the URL manually, always wait for the SDK.
 *
 * The property unique to this page (beyond the registry callback's own
 * coverage) is that emailConfirmSupabase.auth.signOut() must fire on every
 * path — success, failure, and exception — since that magic-link session's
 * only job is to prove inbox control; it must never persist or collide
 * with the leader's real anonymous app session (see
 * lib/emailConfirmSupabaseClient.ts's comment on why).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

type AuthChangeCallback = (event: string, session: unknown) => void;

let authChangeCallback: AuthChangeCallback | null = null;
const mockUnsubscribe = vi.fn();
const mockOnAuthStateChange = vi.fn((cb: AuthChangeCallback) => {
  authChangeCallback = cb;
  return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
});
const mockGetSession = vi.fn();
const mockSignOut = vi.fn();

vi.mock('@/lib/emailConfirmSupabaseClient', () => ({
  emailConfirmSupabase: {
    auth: {
      onAuthStateChange: (cb: AuthChangeCallback) => mockOnAuthStateChange(cb),
      getSession: (...args: unknown[]) => mockGetSession(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
    },
  },
}));

import ConfirmEmailPage from '../page';

const originalFetch = global.fetch;

describe('ConfirmEmailPage', () => {
  beforeEach(() => {
    authChangeCallback = null;
    mockOnAuthStateChange.mockClear();
    mockUnsubscribe.mockReset();
    mockGetSession.mockReset().mockResolvedValue({ data: { session: null } });
    mockSignOut.mockReset().mockResolvedValue({ error: null });
    global.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  it('confirms the email and signs out once SIGNED_IN fires (the #hash callback shape)', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, email: 'alice@example.com' }),
    } as Response);

    render(<ConfirmEmailPage />);
    expect(authChangeCallback).not.toBeNull();

    authChangeCallback!('SIGNED_IN', { access_token: 'tok-123' });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/confirm-email',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok-123' }),
      }),
    ));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });

  it('forwards the leaderId query param from the magic-link redirect so confirmation is scoped to that leader', async () => {
    window.history.pushState({}, '', '/confirm-email?leaderId=leader-42');
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, email: 'alice@example.com' }),
    } as Response);

    render(<ConfirmEmailPage />);
    authChangeCallback!('SIGNED_IN', { access_token: 'tok-123' });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/confirm-email',
      expect.objectContaining({ body: JSON.stringify({ leaderId: 'leader-42' }) }),
    ));

    window.history.pushState({}, '', '/confirm-email');
  });

  it('handles the race where a session already exists before onAuthStateChange is attached', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok-456' } } });
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, email: 'bob@example.com' }),
    } as Response);

    render(<ConfirmEmailPage />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/confirm-email',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok-456' }) }),
    ));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });

  it('still signs out when the confirm-email API returns an error', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'This confirmation link is no longer valid.' }),
    } as Response);

    render(<ConfirmEmailPage />);
    authChangeCallback!('SIGNED_IN', { access_token: 'tok-789' });

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });

  it('still signs out when the fetch call itself throws', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('network down'));

    render(<ConfirmEmailPage />);
    authChangeCallback!('SIGNED_IN', { access_token: 'tok-000' });

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });

  it('gives up after 8s if no session ever materializes (invalid/expired/reused link)', async () => {
    vi.useFakeTimers();
    render(<ConfirmEmailPage />);

    await vi.advanceTimersByTimeAsync(8000);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('does not process a second SIGNED_IN event after already handling one', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, email: 'alice@example.com' }),
    } as Response);

    render(<ConfirmEmailPage />);
    authChangeCallback!('SIGNED_IN', { access_token: 'tok-1' });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    authChangeCallback!('SIGNED_IN', { access_token: 'tok-2' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
