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
 * coverage) is that the isolated magic-link session must never linger or
 * collide with the leader's real anonymous app session (see
 * lib/emailConfirmSupabaseClient.ts's comment on why): emailConfirmSupabase
 * .auth.signOut() fires immediately on every failure path, and on success it
 * fires as soon as the leader picks "Skip for now", finishes/cancels the
 * optional 2FA setup that session is kept alive for, or leaves the choice
 * screen idle for MFA_ABANDON_AFTER_MS.
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

import ConfirmEmailPage from '../page';

const originalFetch = global.fetch;

describe('ConfirmEmailPage', () => {
  beforeEach(() => {
    authChangeCallback = null;
    mockOnAuthStateChange.mockClear();
    mockUnsubscribe.mockReset();
    mockGetSession.mockReset().mockResolvedValue({ data: { session: null } });
    mockSignOut.mockReset().mockResolvedValue({ error: null });
    mockListFactors.mockReset().mockResolvedValue({ data: { all: [] }, error: null });
    mockUnenroll.mockReset().mockResolvedValue({ data: {}, error: null });
    mockEnroll.mockReset().mockResolvedValue({
      data: { id: 'totp-factor-1', totp: { uri: 'otpauth://totp/AFJ:test@example.com?secret=SECRETKEY', secret: 'SECRETKEY' } },
      error: null,
    });
    mockChallengeAndVerify.mockReset().mockResolvedValue({ error: null });
    mockGetAuthenticatorAssuranceLevel.mockReset().mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null });
    global.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  it('confirms the email once SIGNED_IN fires (the #hash callback shape) and offers 2FA setup instead of signing out straight away', async () => {
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
    expect(await screen.findByRole('button', { name: /set up two-factor authentication/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /skip for now/i })).toBeInTheDocument();
    expect(mockSignOut).not.toHaveBeenCalled();
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
    expect(await screen.findByRole('button', { name: /skip for now/i })).toBeInTheDocument();
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

  describe('after the email is confirmed (the 2FA offer)', () => {
    const originalLocation = window.location;

    beforeEach(() => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, email: 'alice@example.com' }),
      } as Response);
    });

    afterEach(() => {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    });

    async function confirmEmail() {
      render(<ConfirmEmailPage />);
      authChangeCallback!('SIGNED_IN', { access_token: 'tok-123' });
      await screen.findByRole('button', { name: /skip for now/i });
    }

    it('"Skip for now" signs out and goes to the app', async () => {
      const assign = vi.fn();
      Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, assign } });
      await confirmEmail();

      fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));

      await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
      await waitFor(() => expect(assign).toHaveBeenCalledWith('/app'));
    });

    it('tells a leader who ends up in a different browser what to do, so a sign-in screen is not a dead end', async () => {
      await confirmEmail();
      expect(screen.getByText(/go back to the AFJ app where you started signing in/i)).toBeInTheDocument();
    });

    it('"Set up two-factor authentication" goes straight to the QR code with no second email, then completes on the same session', async () => {
      await confirmEmail();

      fireEvent.click(screen.getByRole('button', { name: /set up two-factor authentication/i }));

      const qr = await screen.findByTestId('qrcode');
      expect(qr.getAttribute('data-value')).toContain('SECRETKEY');
      expect(mockSignOut).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }));

      await waitFor(() => expect(mockChallengeAndVerify).toHaveBeenCalledWith({ factorId: 'totp-factor-1', code: '123456' }));
      await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/complete-mfa-setup',
        expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer tok-123' } }),
      ));
      await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
      expect(await screen.findByText(/two-factor authentication is set up/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /continue/i })).toHaveAttribute('href', '/app');
    });

    it('cancelling the setup signs out and confirms the email is still fine', async () => {
      await confirmEmail();
      fireEvent.click(screen.getByRole('button', { name: /set up two-factor authentication/i }));
      await screen.findByTestId('qrcode');

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
      expect(await screen.findByText(/your email is confirmed, and you can set up two-factor authentication another time/i)).toBeInTheDocument();
    });

    it('signs out after 5 minutes of sitting on the choice screen (bounds the lingering-session window)', async () => {
      vi.useFakeTimers();
      render(<ConfirmEmailPage />);
      await act(async () => { authChangeCallback!('SIGNED_IN', { access_token: 'tok-123' }); });
      expect(screen.getByRole('button', { name: /skip for now/i })).toBeInTheDocument();
      expect(mockSignOut).not.toHaveBeenCalled();

      await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });

      expect(mockSignOut).toHaveBeenCalled();
      expect(screen.getByRole('link', { name: /continue/i })).toHaveAttribute('href', '/app');
    });
  });
});
