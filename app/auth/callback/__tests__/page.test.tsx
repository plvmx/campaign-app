/**
 * Regression test: app/auth/callback used to be a Route Handler that ran
 * supabase.auth.exchangeCodeForSession() server-side, using the same
 * browser-oriented `supabase` client the rest of the app uses. That client
 * persists sessions to localStorage, which doesn't exist server-side — the
 * exchange "succeeded" but the resulting session had nowhere to land for
 * the visitor's browser, so the magic-link flow silently produced no
 * session at all.
 *
 * The fix makes this a client component page, so the exchange runs in the
 * same browser context that will use the session. A Route Handler can't be
 * rendered with React Testing Library at all (it's not a component) — the
 * very fact that this file can import and render a default export from
 * './page' is itself part of what pre-fix code could never do.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

const mockExchangeCodeForSession = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      exchangeCodeForSession: (...args: unknown[]) => mockExchangeCodeForSession(...args),
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
    mockExchangeCodeForSession.mockReset();
    mockReplace.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('exchanges the code client-side and redirects to the requested next path on success', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null });
    setUrl('?code=abc123&next=%2Fregistry');

    render(<AuthCallbackPage />);

    await waitFor(() => expect(mockExchangeCodeForSession).toHaveBeenCalledWith('abc123'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/registry'));
  });

  it('redirects to login with an error when the exchange fails', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: new Error('invalid code') });
    setUrl('?code=bad-code&next=%2Fapp');

    render(<AuthCallbackPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login?error=auth_failed'));
  });

  it('redirects to login without attempting an exchange when no code is present', async () => {
    setUrl('');

    render(<AuthCallbackPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login?error=auth_failed'));
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('falls back to /app when next is a protocol-relative open-redirect attempt', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null });
    setUrl('?code=abc123&next=%2F%2Fevil.com');

    render(<AuthCallbackPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/app'));
  });

  it('renders a signing-in placeholder', () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null });
    setUrl('?code=abc123');

    render(<AuthCallbackPage />);

    expect(screen.getByText(/signing you in/i)).toBeInTheDocument();
  });
});
