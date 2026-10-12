/**
 * Scanner-proof magic link — see app/setup-mfa/__tests__/tapLink.test.tsx and
 * lib/magicLinkToken.ts. The token must only be used when the person taps.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

type AuthChangeCallback = (event: string, session: unknown) => void;
let authChangeCallback: AuthChangeCallback | null = null;
const mockVerifyOtp = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: AuthChangeCallback) => {
        authChangeCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: () => Promise.resolve({ data: { session: null } }),
      signOut: () => Promise.resolve({ error: null }),
      verifyOtp: (...a: unknown[]) => mockVerifyOtp(...a),
      mfa: {
        getAuthenticatorAssuranceLevel: () => Promise.resolve({ data: { currentLevel: 'aal1', nextLevel: 'aal2' } }),
        listFactors: () => Promise.resolve({ data: { totp: [{ id: 'totp-1', status: 'verified' }] } }),
        challengeAndVerify: () => Promise.resolve({ error: null }),
      },
    },
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => Promise.resolve({ data: [{ id: 'sl-1', state: 'VIC', leader: 'Peter', admin: null, mfa_enrolled_at: '2026-09-01T00:00:00Z' }], error: null });
      return b;
    },
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/contexts/UserContext', () => ({ useUser: () => ({ refresh: vi.fn() }) }));

import LoginMfaCallbackPage from '../page';

beforeEach(() => {
  authChangeCallback = null;
  mockVerifyOtp.mockReset().mockResolvedValue({ error: null });
  window.history.replaceState(null, '', '/login/mfa/callback?via=email&token_hash=hash-3&type=email');
});
afterEach(() => { cleanup(); vi.useRealTimers(); window.history.replaceState(null, '', '/'); });

describe('LoginMfaCallbackPage — tap-to-continue link', () => {
  it('shows a button and does NOT use the token on load', async () => {
    render(<LoginMfaCallbackPage />);
    expect(await screen.findByRole('button', { name: /finish signing in/i })).toBeInTheDocument();
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it('keeps waiting for the tap well past the old 8-second give-up', async () => {
    vi.useFakeTimers();
    render(<LoginMfaCallbackPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(screen.getByRole('button', { name: /finish signing in/i })).toBeInTheDocument();
    expect(screen.queryByText(/already been used/i)).not.toBeInTheDocument();
  });

  it('uses the token only on tap, removes it from the address bar, then goes on to the authenticator challenge', async () => {
    render(<LoginMfaCallbackPage />);
    fireEvent.click(await screen.findByRole('button', { name: /finish signing in/i }));
    await waitFor(() => expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: 'hash-3', type: 'email' }));
    expect(window.location.search).not.toContain('token_hash');

    await act(async () => { authChangeCallback!('SIGNED_IN', { user: { id: 'user-1' } }); });
    expect(await screen.findByText(/enter your authenticator code/i)).toBeInTheDocument();
  });

  it('falls back to the email + code form if the token was already used', async () => {
    mockVerifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });
    render(<LoginMfaCallbackPage />);
    fireEvent.click(await screen.findByRole('button', { name: /finish signing in/i }));
    expect(await screen.findByText(/that link has already been used/i)).toBeInTheDocument();
  });
});
