/**
 * Mirrors two existing regression-tested patterns this page reuses:
 * - app/registry/mfa/enroll/__tests__/page.test.tsx's TOTP mechanics (QR
 *   from totp.uri not the bloated qr_code SVG; stale unverified factor
 *   cleanup scoped by factor_type before a fresh enroll).
 * - app/confirm-email/__tests__/page.test.tsx's sign-in-wait pattern
 *   (SIGNED_IN event + getSession race-cover + give-up timeout) and its
 *   "signOut always fires" property — this page's session likewise only
 *   ever exists to complete enrollment, never to persist.
 * Authenticator app (TOTP) is the only enrollment method (Peter's call,
 * 2026-09-27 — no SMS choice), so signing in goes straight into TOTP
 * enrollment with no method-choice screen in between.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

vi.mock('react-qr-code', () => ({
  default: ({ value }: { value: string }) => <div data-testid="qrcode" data-value={value} />,
}));

type AuthChangeCallback = (event: string, session: unknown) => void;

let authChangeCallback: AuthChangeCallback | null = null;
const mockUnsubscribe = vi.fn();
const mockOnAuthStateChange = vi.fn((cb: AuthChangeCallback) => {
  authChangeCallback = cb;
  return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
});
const mockGetSession = vi.fn();
const mockSignOut = vi.fn();
const mockListFactors = vi.fn();
const mockUnenroll = vi.fn();
const mockEnroll = vi.fn();
const mockChallengeAndVerify = vi.fn();
const mockGetAuthenticatorAssuranceLevel = vi.fn();

vi.mock('@/lib/emailConfirmSupabaseClient', () => ({
  emailConfirmSupabase: {
    auth: {
      onAuthStateChange: (cb: AuthChangeCallback) => mockOnAuthStateChange(cb),
      getSession: (...args: unknown[]) => mockGetSession(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      mfa: {
        listFactors: (...args: unknown[]) => mockListFactors(...args),
        unenroll: (...args: unknown[]) => mockUnenroll(...args),
        enroll: (...args: unknown[]) => mockEnroll(...args),
        challengeAndVerify: (...args: unknown[]) => mockChallengeAndVerify(...args),
        getAuthenticatorAssuranceLevel: (...args: unknown[]) => mockGetAuthenticatorAssuranceLevel(...args),
      },
    },
  },
}));

import SetupMfaPage from '../page';

const SESSION = { access_token: 'tok-123', user: { id: 'user-1' } };
const TOTP_ENROLL_RESPONSE = {
  data: { id: 'totp-factor-1', totp: { uri: 'otpauth://totp/AFJ:test@example.com?secret=SECRETKEY&issuer=AFJ', secret: 'SECRETKEY' } },
  error: null,
};

const originalFetch = global.fetch;

async function signIn() {
  render(<SetupMfaPage />);
  authChangeCallback!('SIGNED_IN', SESSION);
  await waitFor(() => expect(screen.getByRole('heading', { name: /authenticator app/i })).toBeInTheDocument());
}

describe('SetupMfaPage', () => {
  beforeEach(() => {
    authChangeCallback = null;
    mockOnAuthStateChange.mockClear();
    mockUnsubscribe.mockReset();
    mockGetSession.mockReset().mockResolvedValue({ data: { session: null } });
    mockSignOut.mockReset().mockResolvedValue({ error: null });
    mockListFactors.mockReset().mockResolvedValue({ data: { all: [] }, error: null });
    mockUnenroll.mockReset().mockResolvedValue({ data: {}, error: null });
    mockEnroll.mockReset().mockResolvedValue(TOTP_ENROLL_RESPONSE);
    mockChallengeAndVerify.mockReset().mockResolvedValue({ error: null });
    // aal1/aal1 (no verified factor elsewhere yet) is the common case — the
    // step-up tests below override this to aal1/aal2 to simulate an account
    // with an existing verified factor (e.g. from the /registry portal).
    mockGetAuthenticatorAssuranceLevel.mockReset().mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  it('goes straight into authenticator-app enrollment once signed in — no method choice', async () => {
    await signIn();
    const qr = await screen.findByTestId('qrcode');
    expect(qr.getAttribute('data-value')).toBe(TOTP_ENROLL_RESPONSE.data.totp.uri);
  });

  it('gives up and shows "Back to sign in" if no session ever materializes', async () => {
    vi.useFakeTimers();
    render(<SetupMfaPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(screen.getByText(/link expired/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
  });

  it('signs out and expires the session if enrollment is left abandoned mid-flow (bounds the lingering-session window)', async () => {
    vi.useFakeTimers();
    render(<SetupMfaPage />);
    await act(async () => { authChangeCallback!('SIGNED_IN', SESSION); });
    expect(screen.getByRole('heading', { name: /authenticator app/i })).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });

    expect(mockSignOut).toHaveBeenCalled();
    expect(screen.getByText(/link expired/i)).toBeInTheDocument();
  });

  describe('Step-up (account already has a verified factor elsewhere)', () => {
    beforeEach(() => {
      mockGetAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null });
      mockListFactors.mockResolvedValue({
        data: { all: [{ id: 'existing-verified-totp', factor_type: 'totp', status: 'verified' }] },
        error: null,
      });
    });

    it('shows a step-up verification screen instead of going straight into enrollment', async () => {
      render(<SetupMfaPage />);
      await act(async () => { authChangeCallback!('SIGNED_IN', SESSION); });

      expect(await screen.findByText(/verify your identity/i)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /authenticator app/i })).not.toBeInTheDocument();
    });

    it('completes enrollment directly after a successful step-up challenge, without asking for a second factor', async () => {
      render(<SetupMfaPage />);
      await act(async () => { authChangeCallback!('SIGNED_IN', SESSION); });
      await screen.findByText(/verify your identity/i);

      fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '111222' } });
      fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }));

      await waitFor(() => expect(mockChallengeAndVerify).toHaveBeenCalledWith({ factorId: 'existing-verified-totp', code: '111222' }));
      // The existing verified factor already satisfies MFA for this account —
      // it must go straight to completion, never on to a fresh TOTP enroll
      // (confirmed live, 2026-09-26: Peter was asked to scan a brand new QR
      // code right after proving he already had one set up).
      await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/complete-mfa-setup',
        expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer tok-123' } }),
      ));
      await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
      expect(await screen.findByRole('link', { name: /continue/i })).toHaveAttribute('href', '/app');
      expect(mockEnroll).not.toHaveBeenCalled();
    });

    it('cancelling step-up signs out and shows a "no problem" screen', async () => {
      render(<SetupMfaPage />);
      await act(async () => { authChangeCallback!('SIGNED_IN', SESSION); });
      await screen.findByText(/verify your identity/i);

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
      expect(await screen.findByText(/no problem/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
    });
  });

  describe('TOTP enrollment', () => {
    it('renders a compact QR from totp.uri and the manual-entry secret', async () => {
      await signIn();
      const qr = await screen.findByTestId('qrcode');
      expect(qr.getAttribute('data-value')).toBe(TOTP_ENROLL_RESPONSE.data.totp.uri);
      expect(screen.getByText('SECRETKEY')).toBeInTheDocument();
    });

    it('unenrolls a stale unverified TOTP factor (not some other factor type on the account) before enrolling fresh', async () => {
      mockListFactors.mockResolvedValue({
        data: {
          all: [
            { id: 'stale-totp', factor_type: 'totp', status: 'unverified' },
            { id: 'other-type', factor_type: 'phone', status: 'unverified' },
          ],
        },
        error: null,
      });
      await signIn();

      await waitFor(() => expect(mockUnenroll).toHaveBeenCalledTimes(1));
      expect(mockUnenroll).toHaveBeenCalledWith({ factorId: 'stale-totp' });
      expect(mockEnroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: 'AFJ Campaign App (Authenticator)' });
    });

    it('completes enrollment, posts to complete-mfa-setup, signs out, and shows Continue', async () => {
      await signIn();
      await screen.findByTestId('qrcode');

      fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }));

      await waitFor(() => expect(mockChallengeAndVerify).toHaveBeenCalledWith({ factorId: 'totp-factor-1', code: '123456' }));
      await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/complete-mfa-setup',
        expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer tok-123' } }),
      ));
      await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
      expect(await screen.findByRole('link', { name: /continue/i })).toHaveAttribute('href', '/app');
    });

    it('cancelling signs out and shows a "no problem" screen', async () => {
      await signIn();

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
      expect(await screen.findByText(/no problem/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
    });
  });
});
