/**
 * Scanner-proof magic link (lib/magicLinkToken.ts): the email link brings the
 * person here with ?token_hash=…, and the token must only be used when they
 * TAP the button — a mail program that merely opens the link must not use it
 * up (the Apple Mail / Outlook failure seen repeatedly). These cover the
 * page behaviour that makes that true.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

vi.mock('react-qr-code', () => ({ default: ({ value }: { value: string }) => <div data-testid="qrcode" data-value={value} /> }));

type AuthChangeCallback = (event: string, session: unknown) => void;
let authChangeCallback: AuthChangeCallback | null = null;
const mockVerifyOtp = vi.fn();

vi.mock('@/lib/emailConfirmSupabaseClient', () => ({
  emailConfirmSupabase: {
    auth: {
      onAuthStateChange: (cb: AuthChangeCallback) => {
        authChangeCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: () => Promise.resolve({ data: { session: null } }),
      signOut: () => Promise.resolve({ error: null }),
      verifyOtp: (...a: unknown[]) => mockVerifyOtp(...a),
      mfa: {
        listFactors: () => Promise.resolve({ data: { all: [] }, error: null }),
        unenroll: () => Promise.resolve({ data: {}, error: null }),
        enroll: () => Promise.resolve({ data: { id: 'f1', totp: { uri: 'otpauth://x', secret: 'S' } }, error: null }),
        challengeAndVerify: () => Promise.resolve({ error: null }),
        getAuthenticatorAssuranceLevel: () => Promise.resolve({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }),
      },
    },
  },
}));

import SetupMfaPage from '../page';

beforeEach(() => {
  authChangeCallback = null;
  mockVerifyOtp.mockReset().mockResolvedValue({ error: null });
  window.history.replaceState(null, '', '/setup-mfa?via=email&token_hash=hash-1&type=email');
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
});
afterEach(() => { cleanup(); vi.useRealTimers(); window.history.replaceState(null, '', '/'); });

describe('SetupMfaPage — tap-to-continue link', () => {
  it('shows a button and does NOT use the token on load', async () => {
    render(<SetupMfaPage />);
    expect(await screen.findByRole('button', { name: /continue setting up/i })).toBeInTheDocument();
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it('keeps waiting for the tap well past the old 8-second give-up', async () => {
    vi.useFakeTimers();
    render(<SetupMfaPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(screen.getByRole('button', { name: /continue setting up/i })).toBeInTheDocument();
    expect(screen.queryByText(/already been used/i)).not.toBeInTheDocument();
  });

  it('uses the token only on tap, and removes it from the address bar', async () => {
    render(<SetupMfaPage />);
    fireEvent.click(await screen.findByRole('button', { name: /continue setting up/i }));

    await waitFor(() => expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: 'hash-1', type: 'email' }));
    expect(window.location.search).not.toContain('token_hash');
  });

  it('carries on to the QR code once the tap signs the person in', async () => {
    render(<SetupMfaPage />);
    fireEvent.click(await screen.findByRole('button', { name: /continue setting up/i }));
    await waitFor(() => expect(mockVerifyOtp).toHaveBeenCalled());

    await act(async () => { authChangeCallback!('SIGNED_IN', { access_token: 'tok', user: { id: 'u1' } }); });
    expect(await screen.findByTestId('qrcode')).toBeInTheDocument();
  });

  it('falls back to the email + code form if the token was already used', async () => {
    mockVerifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });
    render(<SetupMfaPage />);
    fireEvent.click(await screen.findByRole('button', { name: /continue setting up/i }));

    expect(await screen.findByText(/that link has already been used/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/code from the email/i)).toBeInTheDocument();
  });
});
