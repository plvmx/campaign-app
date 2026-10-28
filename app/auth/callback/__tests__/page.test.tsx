/**
 * Regression test, round 2: the first fix to this page (see git history)
 * correctly moved the code exchange client-side, but still manually
 * checked window.location.search for a ?code= param and gave up
 * immediately when absent. That's exactly wrong for this project —
 * supabase-js's default auth flow ('implicit') delivers a magic-link
 * session as a #access_token=... hash fragment, never a ?code=, so the
 * old logic treated every genuine successful sign-in as a failure. This
 * was confirmed live while building the /registry portal's identical
 * callback page before this one ever shipped. The fix relies on
 * lib/supabaseClient's detectSessionInUrl: true (already set, unchanged)
 * firing a SIGNED_IN event instead of parsing the URL itself.
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

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: AuthChangeCallback) => mockOnAuthStateChange(cb),
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

import AuthCallbackPage from '../page';

function setUrl(search: string) {
  window.history.pushState({}, '', `/auth/callback${search}`);
}

describe('AuthCallbackPage', () => {
  beforeEach(() => {
    authChangeCallback = null;
    mockOnAuthStateChange.mockClear();
    mockUnsubscribe.mockReset();
    mockGetSession.mockReset().mockResolvedValue({ data: { session: null } });
    mockReplace.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('redirects to the requested next path once SIGNED_IN fires (the #hash callback shape)', async () => {
    setUrl('?next=%2Fregistry');
    render(<AuthCallbackPage />);
    expect(authChangeCallback).not.toBeNull();

    authChangeCallback!('SIGNED_IN', { user: {} });

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/registry'));
  });

  it('handles the race where a session already exists before onAuthStateChange is attached', async () => {
    setUrl('?next=%2Fapp');
    mockGetSession.mockResolvedValue({ data: { session: { user: {} } } });

    render(<AuthCallbackPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/app'));
  });

  it('falls back to /app when next is a protocol-relative open-redirect attempt', async () => {
    setUrl('?next=%2F%2Fevil.com');
    render(<AuthCallbackPage />);

    authChangeCallback!('SIGNED_IN', { user: {} });

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/app'));
  });

  it('gives up and redirects to login if no session ever materializes (invalid/expired/reused link)', async () => {
    setUrl('');
    vi.useFakeTimers();
    render(<AuthCallbackPage />);

    await vi.advanceTimersByTimeAsync(8000);

    expect(mockReplace).toHaveBeenCalledWith('/login?error=auth_failed');
  });

  it('does not process a second SIGNED_IN event after already handling one', async () => {
    setUrl('?next=%2Fapp');
    render(<AuthCallbackPage />);
    authChangeCallback!('SIGNED_IN', { user: {} });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));

    authChangeCallback!('SIGNED_IN', { user: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it('renders a signing-in placeholder', () => {
    setUrl('');
    render(<AuthCallbackPage />);
    expect(document.body.textContent).toMatch(/signing you in/i);
  });
});
