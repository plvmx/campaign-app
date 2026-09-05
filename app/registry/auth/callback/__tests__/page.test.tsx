/**
 * Regression test: this page used to manually check window.location.search
 * for a ?code= param and give up immediately if absent. That's exactly
 * what broke a real sign-in attempt — this project's actual callback shape
 * is a #access_token=... hash fragment (supabase-js's default 'implicit'
 * flow), never a ?code=, so the old logic always treated a genuine
 * successful sign-in as a failure. The fix relies on
 * registrySupabaseClient's detectSessionInUrl: true (which handles both
 * shapes) firing a SIGNED_IN event instead.
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

vi.mock('@/lib/registrySupabaseClient', () => ({
  registrySupabase: {
    auth: {
      onAuthStateChange: (cb: AuthChangeCallback) => mockOnAuthStateChange(cb),
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

const mockGetRegistryAccessState = vi.fn();
const mockSetRegistryAuthCookie = vi.fn();
const mockSetRegistrySessionCookie = vi.fn();
const mockSignOutOfRegistry = vi.fn();
vi.mock('@/lib/registryAuth', () => ({
  getRegistryAccessState: (...args: unknown[]) => mockGetRegistryAccessState(...args),
  setRegistryAuthCookie: (...args: unknown[]) => mockSetRegistryAuthCookie(...args),
  setRegistrySessionCookie: (...args: unknown[]) => mockSetRegistrySessionCookie(...args),
  signOutOfRegistry: (...args: unknown[]) => mockSignOutOfRegistry(...args),
}));

const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

import RegistryAuthCallbackPage from '../page';

describe('RegistryAuthCallbackPage', () => {
  beforeEach(() => {
    authChangeCallback = null;
    mockOnAuthStateChange.mockClear();
    mockUnsubscribe.mockReset();
    mockGetSession.mockReset().mockResolvedValue({ data: { session: null } });
    mockGetRegistryAccessState.mockReset();
    mockSetRegistryAuthCookie.mockReset();
    mockSetRegistrySessionCookie.mockReset();
    mockSignOutOfRegistry.mockReset();
    mockReplace.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('routes to /registry and sets the full session cookie once SIGNED_IN fires (the #hash callback shape)', async () => {
    mockGetRegistryAccessState.mockResolvedValue({ result: 'ok', leaderRole: { role: 'national_admin', mfa_required: true } });

    render(<RegistryAuthCallbackPage />);
    expect(authChangeCallback).not.toBeNull();

    authChangeCallback!('SIGNED_IN', { user: {} });

    await waitFor(() => expect(mockSetRegistryAuthCookie).toHaveBeenCalled());
    await waitFor(() => expect(mockSetRegistrySessionCookie).toHaveBeenCalled());
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/registry'));
  });

  it('handles the race where a session already exists before onAuthStateChange is attached', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: {} } } });
    mockGetRegistryAccessState.mockResolvedValue({ result: 'needs_enrollment', leaderRole: { role: 'national_admin', mfa_required: true } });

    render(<RegistryAuthCallbackPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/registry/mfa/enroll'));
    expect(mockSetRegistrySessionCookie).not.toHaveBeenCalled();
  });

  it('signs out and redirects to no-access when the account has no leader_roles row', async () => {
    mockGetRegistryAccessState.mockResolvedValue({ result: 'no_access', leaderRole: null });

    render(<RegistryAuthCallbackPage />);
    authChangeCallback!('SIGNED_IN', { user: {} });

    await waitFor(() => expect(mockSignOutOfRegistry).toHaveBeenCalled());
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/registry/no-access'));
  });

  it('gives up and redirects to login if no session ever materializes (invalid/expired/reused link)', async () => {
    vi.useFakeTimers();
    render(<RegistryAuthCallbackPage />);

    await vi.advanceTimersByTimeAsync(8000);

    expect(mockReplace).toHaveBeenCalledWith('/registry/login?error=auth_failed');
    expect(mockGetRegistryAccessState).not.toHaveBeenCalled();
  });

  it('does not process a second SIGNED_IN event after already handling one', async () => {
    mockGetRegistryAccessState.mockResolvedValue({ result: 'ok', leaderRole: { role: 'national_admin', mfa_required: true } });

    render(<RegistryAuthCallbackPage />);
    authChangeCallback!('SIGNED_IN', { user: {} });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));

    authChangeCallback!('SIGNED_IN', { user: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockGetRegistryAccessState).toHaveBeenCalledTimes(1);
  });
});
