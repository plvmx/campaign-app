/**
 * Scanner-proof magic link — the registry portal shares the one Supabase
 * Magic Link email template with the leader flows, so its landing page must
 * understand ?token_hash too (see lib/magicLinkToken.ts). The token must only
 * be used when the person taps.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

type AuthChangeCallback = (event: string, session: unknown) => void;
let authChangeCallback: AuthChangeCallback | null = null;
const mockVerifyOtp = vi.fn();
const mockReplace = vi.fn();

vi.mock('@/lib/registrySupabaseClient', () => ({
  registrySupabase: {
    auth: {
      onAuthStateChange: (cb: AuthChangeCallback) => {
        authChangeCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: () => Promise.resolve({ data: { session: null } }),
      verifyOtp: (...a: unknown[]) => mockVerifyOtp(...a),
    },
  },
}));
vi.mock('@/lib/registryAuth', () => ({
  getRegistryAccessState: vi.fn().mockResolvedValue({ result: 'ok' }),
  setRegistryAuthCookie: vi.fn(),
  setRegistrySessionCookie: vi.fn(),
  signOutOfRegistry: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mockReplace }) }));

import RegistryAuthCallbackPage from '../page';

beforeEach(() => {
  authChangeCallback = null;
  mockReplace.mockReset();
  mockVerifyOtp.mockReset().mockResolvedValue({ error: null });
  window.history.replaceState(null, '', '/registry/auth/callback?via=email&token_hash=hash-4&type=email');
});
afterEach(() => { cleanup(); vi.useRealTimers(); window.history.replaceState(null, '', '/'); });

describe('RegistryAuthCallbackPage — tap-to-continue link', () => {
  it('shows a button and does NOT use the token on load', async () => {
    render(<RegistryAuthCallbackPage />);
    expect(await screen.findByRole('button', { name: /finish signing in/i })).toBeInTheDocument();
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it('keeps waiting for the tap well past the old 8-second give-up (no redirect to the login error)', async () => {
    vi.useFakeTimers();
    render(<RegistryAuthCallbackPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(screen.getByRole('button', { name: /finish signing in/i })).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('uses the token only on tap, then carries on once signed in', async () => {
    render(<RegistryAuthCallbackPage />);
    fireEvent.click(await screen.findByRole('button', { name: /finish signing in/i }));
    await waitFor(() => expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: 'hash-4', type: 'email' }));
    expect(window.location.search).not.toContain('token_hash');

    await act(async () => { authChangeCallback!('SIGNED_IN', { user: { id: 'u1' } }); });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/registry'));
  });

  it('sends the person to the login error page if the token was already used', async () => {
    mockVerifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });
    render(<RegistryAuthCallbackPage />);
    fireEvent.click(await screen.findByRole('button', { name: /finish signing in/i }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/registry/login?error=auth_failed'));
  });
});
