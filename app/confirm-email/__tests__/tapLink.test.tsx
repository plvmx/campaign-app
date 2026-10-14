/**
 * Scanner-proof magic link — see app/setup-mfa/__tests__/tapLink.test.tsx and
 * lib/magicLinkToken.ts. The token must only be used when the person taps.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

vi.mock('react-qr-code', () => ({ default: () => <div data-testid="qrcode" /> }));

type AuthChangeCallback = (event: string, session: unknown) => void;
let authChangeCallback: AuthChangeCallback | null = null;
const mockVerifyOtp = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@/lib/emailConfirmSupabaseClient', () => ({
  emailConfirmSupabase: {
    auth: {
      onAuthStateChange: (cb: AuthChangeCallback) => {
        authChangeCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: () => mockGetSession(),
      signOut: () => Promise.resolve({ error: null }),
      verifyOtp: (...a: unknown[]) => mockVerifyOtp(...a),
      mfa: {},
    },
  },
}));

import ConfirmEmailPage from '../page';

beforeEach(() => {
  authChangeCallback = null;
  mockVerifyOtp.mockReset().mockResolvedValue({ error: null });
  mockGetSession.mockReset().mockResolvedValue({ data: { session: null } });
  window.history.replaceState(null, '', '/confirm-email?leaderId=leader-9&token_hash=hash-2&type=email');
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, email: 'a@example.com' }) });
});
afterEach(() => { cleanup(); vi.useRealTimers(); window.history.replaceState(null, '', '/'); });

describe('ConfirmEmailPage — tap-to-continue link', () => {
  it('shows a button and does NOT use the token on load', async () => {
    render(<ConfirmEmailPage />);
    expect(await screen.findByRole('button', { name: /confirm my email/i })).toBeInTheDocument();
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('keeps waiting for the tap well past the old 8-second give-up', async () => {
    vi.useFakeTimers();
    render(<ConfirmEmailPage />);
    await act(async () => {}); // let the page reach the tap screen first, as it does at once in a browser
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(screen.getByRole('button', { name: /confirm my email/i })).toBeInTheDocument();
    expect(screen.queryByText(/confirmation failed/i)).not.toBeInTheDocument();
  });

  it('uses the token only on tap, then confirms the email scoped to the leaderId in the URL', async () => {
    render(<ConfirmEmailPage />);
    fireEvent.click(await screen.findByRole('button', { name: /confirm my email/i }));
    await waitFor(() => expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: 'hash-2', type: 'email' }));
    expect(window.location.search).not.toContain('token_hash');
    expect(window.location.search).toContain('leaderId=leader-9');

    await act(async () => { authChangeCallback!('SIGNED_IN', { access_token: 'tok-9' }); });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/confirm-email',
      expect.objectContaining({ body: JSON.stringify({ leaderId: 'leader-9' }) }),
    ));
    expect(await screen.findByText(/has been confirmed/i)).toBeInTheDocument();
  });

  it('confirms with the tapped sign-in, not an older session already saved on the device', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'old-tok' } } });
    render(<ConfirmEmailPage />);
    fireEvent.click(await screen.findByRole('button', { name: /confirm my email/i }));
    await waitFor(() => expect(mockVerifyOtp).toHaveBeenCalled());

    await act(async () => { authChangeCallback!('SIGNED_IN', { access_token: 'tok-9' }); });
    expect(await screen.findByText(/has been confirmed/i)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/confirm-email', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tok-9' }),
    }));
  });

  it('offers a way out instead of freezing on "Confirming your email…" if confirming never finishes', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<ConfirmEmailPage />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: /confirm my email/i }));
    await act(async () => { authChangeCallback!('SIGNED_IN', { access_token: 'tok-9' }); });
    expect(screen.getByText(/confirming your email/i)).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(screen.getByText(/taking too long/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start again/i })).toHaveAttribute('href', '/login');
  });

  it('falls back to the email + code form if the token was already used', async () => {
    mockVerifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });
    render(<ConfirmEmailPage />);
    fireEvent.click(await screen.findByRole('button', { name: /confirm my email/i }));

    expect(await screen.findByText(/already used/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/code from the email/i)).toBeInTheDocument();
  });
});
