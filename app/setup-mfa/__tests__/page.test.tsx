/**
 * Mirrors two existing regression-tested patterns this page reuses:
 * - app/registry/mfa/enroll/__tests__/page.test.tsx's TOTP mechanics (QR
 *   from totp.uri not the bloated qr_code SVG; stale unverified factor
 *   cleanup scoped by factor_type before a fresh enroll).
 * - app/confirm-email/__tests__/page.test.tsx's sign-in-wait pattern
 *   (SIGNED_IN event + getSession race-cover + give-up timeout) and its
 *   "signOut always fires" property — this page's session likewise only
 *   ever exists to complete enrollment, never to persist.
 * The phone/SMS branch has no existing precedent anywhere in this repo —
 * new coverage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { makeQueryBuilder } from '@/lib/services/__tests__/supabaseMock';

vi.mock('react-qr-code', () => ({
  default: ({ value }: { value: string }) => <div data-testid="qrcode" data-value={value} />,
}));

// toE164AuMobile (lib/services/campaignInterestSmsService.ts) transitively
// imports lib/auth.ts, which creates the browser supabase client at import
// time — mock it out so that doesn't require real env vars in tests (same
// convention as lib/__tests__/auth.test.ts).
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: {}, from: vi.fn() },
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
const mockFrom = vi.fn();

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
      },
    },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import SetupMfaPage from '../page';

const SESSION = { access_token: 'tok-123', user: { id: 'user-1' } };
const TOTP_ENROLL_RESPONSE = {
  data: { id: 'totp-factor-1', totp: { uri: 'otpauth://totp/AFJ:test@example.com?secret=SECRETKEY&issuer=AFJ', secret: 'SECRETKEY' } },
  error: null,
};
const PHONE_ENROLL_RESPONSE = { data: { id: 'phone-factor-1' }, error: null };

const originalFetch = global.fetch;

async function signIn() {
  render(<SetupMfaPage />);
  authChangeCallback!('SIGNED_IN', SESSION);
  await waitFor(() => expect(screen.getByText(/use an authenticator app/i)).toBeInTheDocument());
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
    mockFrom.mockReset().mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    // SMS provider isn't connected yet — hidden by default (see the
    // dedicated test below); the Phone branch tests opt in explicitly.
    process.env.NEXT_PUBLIC_SMS_MFA_ENABLED = 'true';
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    global.fetch = originalFetch;
    delete process.env.NEXT_PUBLIC_SMS_MFA_ENABLED;
  });

  it('hides the text-message option unless NEXT_PUBLIC_SMS_MFA_ENABLED is set (no SMS provider connected yet)', async () => {
    delete process.env.NEXT_PUBLIC_SMS_MFA_ENABLED;
    await signIn();
    expect(screen.getByText(/use an authenticator app/i)).toBeInTheDocument();
    expect(screen.queryByText(/use a text message/i)).not.toBeInTheDocument();
  });

  it('shows the method choice once signed in', async () => {
    await signIn();
    expect(screen.getByText(/use a text message/i)).toBeInTheDocument();
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
    expect(screen.getByText(/use an authenticator app/i)).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });

    expect(mockSignOut).toHaveBeenCalled();
    expect(screen.getByText(/link expired/i)).toBeInTheDocument();
  });

  describe('TOTP branch', () => {
    it('renders a compact QR from totp.uri and the manual-entry secret', async () => {
      await signIn();
      fireEvent.click(screen.getByText(/use an authenticator app/i));

      const qr = await screen.findByTestId('qrcode');
      expect(qr.getAttribute('data-value')).toBe(TOTP_ENROLL_RESPONSE.data.totp.uri);
      expect(screen.getByText('SECRETKEY')).toBeInTheDocument();
    });

    it('unenrolls a stale unverified TOTP factor (not a phone one) before enrolling fresh', async () => {
      mockListFactors.mockResolvedValue({
        data: {
          all: [
            { id: 'stale-totp', factor_type: 'totp', status: 'unverified' },
            { id: 'stale-phone', factor_type: 'phone', status: 'unverified' },
          ],
        },
        error: null,
      });
      await signIn();
      fireEvent.click(screen.getByText(/use an authenticator app/i));

      await waitFor(() => expect(mockUnenroll).toHaveBeenCalledTimes(1));
      expect(mockUnenroll).toHaveBeenCalledWith({ factorId: 'stale-totp' });
      await waitFor(() => expect(mockEnroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: 'AFJ Campaign App (Authenticator)' }));
    });

    it('completes enrollment, posts to complete-mfa-setup, signs out, and shows Continue', async () => {
      await signIn();
      fireEvent.click(screen.getByText(/use an authenticator app/i));
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
  });

  describe('Phone branch', () => {
    it('pre-fills the phone number from the leader\'s state_leaders.mobile, converted to E.164, once this method is chosen', async () => {
      mockFrom.mockReturnValue(makeQueryBuilder({ data: { mobile: '0412345678' }, error: null }));
      await signIn();
      // Deferred until the leader actually picks this method — not fetched
      // eagerly on sign-in, so the more common TOTP path never pays for it.
      expect(mockFrom).not.toHaveBeenCalled();

      fireEvent.click(screen.getByText(/use a text message/i));

      await waitFor(() => expect(screen.getByLabelText(/mobile number/i)).toHaveValue('+61412345678'));
    });

    it('enrolls with factorType: phone and the entered number, then verifies the code', async () => {
      mockEnroll.mockResolvedValue(PHONE_ENROLL_RESPONSE);
      await signIn();
      fireEvent.click(screen.getByText(/use a text message/i));

      const phoneInput = screen.getByLabelText(/mobile number/i);
      fireEvent.change(phoneInput, { target: { value: '+61412345678' } });
      fireEvent.click(screen.getByRole('button', { name: /send code/i }));

      await waitFor(() => expect(mockEnroll).toHaveBeenCalledWith({ factorType: 'phone', phone: '+61412345678', friendlyName: 'AFJ Campaign App (SMS)' }));
      expect(await screen.findByLabelText(/6-digit code/i)).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '654321' } });
      fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }));

      await waitFor(() => expect(mockChallengeAndVerify).toHaveBeenCalledWith({ factorId: 'phone-factor-1', code: '654321' }));
      await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
      expect(await screen.findByRole('link', { name: /continue/i })).toHaveAttribute('href', '/app');
    });

    it('unenrolls a stale unverified phone factor (not a totp one) before enrolling fresh', async () => {
      mockListFactors.mockResolvedValue({
        data: {
          all: [
            { id: 'stale-phone', factor_type: 'phone', status: 'unverified' },
            { id: 'stale-totp', factor_type: 'totp', status: 'unverified' },
          ],
        },
        error: null,
      });
      mockEnroll.mockResolvedValue(PHONE_ENROLL_RESPONSE);
      await signIn();
      fireEvent.click(screen.getByText(/use a text message/i));
      fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: '+61412345678' } });
      fireEvent.click(screen.getByRole('button', { name: /send code/i }));

      await waitFor(() => expect(mockUnenroll).toHaveBeenCalledWith({ factorId: 'stale-phone' }));
      expect(mockUnenroll).toHaveBeenCalledTimes(1);
    });

    it('rejects a malformed phone number client-side without calling enroll', async () => {
      await signIn();
      fireEvent.click(screen.getByText(/use a text message/i));
      fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: 'not-a-number' } });
      fireEvent.click(screen.getByRole('button', { name: /send code/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/valid mobile number/i);
      expect(mockEnroll).not.toHaveBeenCalled();
    });

    it('normalizes a local AU-format number to E.164 before enrolling', async () => {
      mockEnroll.mockResolvedValue(PHONE_ENROLL_RESPONSE);
      await signIn();
      fireEvent.click(screen.getByText(/use a text message/i));
      fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: '0412345678' } });
      fireEvent.click(screen.getByRole('button', { name: /send code/i }));

      await waitFor(() => expect(mockEnroll).toHaveBeenCalledWith({ factorType: 'phone', phone: '+61412345678', friendlyName: 'AFJ Campaign App (SMS)' }));
    });

    it('shows a clean message when the phone provider is not configured, not a raw SDK error', async () => {
      mockEnroll.mockResolvedValue({ data: null, error: { message: 'Phone provider is not enabled for this project' } });
      await signIn();
      fireEvent.click(screen.getByText(/use a text message/i));
      fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: '+61412345678' } });
      fireEvent.click(screen.getByRole('button', { name: /send code/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/isn't available yet/i);
      expect(screen.queryByText(/phone provider is not enabled/i)).not.toBeInTheDocument();
    });
  });
});
