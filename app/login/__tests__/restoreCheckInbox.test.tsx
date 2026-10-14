/**
 * A leader reading the emailed code has to leave the app for their mail
 * program, and a phone browser often reloads /login when they come back.
 * /login used to find them already signed in and send them straight to /app —
 * so they never got to type the code (an iPhone leader, 2026-10-12). The
 * "Check your inbox" screen is now remembered (lib/pendingLoginStep.ts) and
 * restored on load instead of redirecting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const mockPush = vi.fn();
// One stable object, like the real Next.js router — a fresh object per render would re-run /login's on-load check.
const mockRouter = { push: mockPush, replace: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/contexts/UserContext', () => ({ useUser: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: {}, from: vi.fn() } }));
const mockVerifyOtp = vi.fn();
vi.mock('@/lib/emailConfirmSupabaseClient', () => ({
  emailConfirmSupabase: { auth: { verifyOtp: (...a: unknown[]) => mockVerifyOtp(...a) } },
}));

const mockGetSession = vi.fn();
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getVerifiedSession: (...a: unknown[]) => mockGetSession(...a),
}));

import LoginPage from '../page';
import { savePendingLoginStep, readPendingLoginStep } from '@/lib/pendingLoginStep';
import type { StateLeaderMatch } from '@/lib/auth';

const PLAIN: StateLeaderMatch = {
  id: 'sl-1', state: 'NSW', leader: 'Jack', mobile: null, admin: null,
  email: null, pendingEmail: 'jack@example.com', suggestedEmail: null, mfaEnrolledAt: null,
};
const ADMIN: StateLeaderMatch = { ...PLAIN, id: 'sl-2', leader: 'Sam_AD', admin: 'AD' };
const SESSION = { user: { id: 'u1' } };

beforeEach(() => {
  localStorage.clear();
  mockPush.mockReset();
  mockGetSession.mockReset().mockResolvedValue(SESSION);
  mockVerifyOtp.mockReset();
});
afterEach(() => cleanup());

describe('LoginPage — restoring "Check your inbox" after a reload', () => {
  it('puts a leader back on the email "Check your inbox" screen (2FA required to see member details) after a reload', async () => {
    mockGetSession.mockResolvedValue(null); // a plain leader on this path has been signed out (lib/twoFactorSetup.ts)
    savePendingLoginStep({ kind: 'email', match: PLAIN, value: 'jack@example.com' });
    render(<LoginPage />);

    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
    expect(screen.getByText('jack@example.com')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    // and the person can see where they are and get help
    expect(screen.getByText(/step 1 of 3: confirm your email/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open the step-by-step guide/i })).toBeInTheDocument();
  });

  it('does the same for the 2FA-setup "Check your inbox" screen', async () => {
    mockGetSession.mockResolvedValue(null);
    savePendingLoginStep({ kind: 'mfa', match: { ...PLAIN, email: 'jack@example.com' } });
    render(<LoginPage />);

    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('still sends a signed-in leader with nothing remembered straight to /app', async () => {
    render(<LoginPage />);
    await screen.findByText(/loading|sign/i).catch(() => undefined);
    await vi.waitFor(() => expect(mockPush).toHaveBeenCalledWith('/app'));
  });

  it('ignores a remembered step that has expired, sends them to /app, and forgets it', async () => {
    savePendingLoginStep({ kind: 'email', match: PLAIN, value: 'jack@example.com' }, Date.now() - 31 * 60 * 1000);
    render(<LoginPage />);

    await vi.waitFor(() => expect(mockPush).toHaveBeenCalledWith('/app'));
    expect(readPendingLoginStep()).toBeNull();
  });

  it('drops a plain leader\'s remembered step if they are signed in (a stale one — they are not in the 2FA flow)', async () => {
    savePendingLoginStep({ kind: 'email', match: PLAIN, value: 'jack@example.com' });
    render(<LoginPage />);

    await vi.waitFor(() => expect(mockPush).toHaveBeenCalledWith('/app'));
    expect(screen.queryByText(/check your inbox/i)).not.toBeInTheDocument();
    expect(readPendingLoginStep()).toBeNull();
  });

  it('restores a plain leader\'s step when they are signed out, with no skip option', async () => {
    mockGetSession.mockResolvedValue(null);
    savePendingLoginStep({ kind: 'email', match: PLAIN, value: 'jack@example.com' });
    render(<LoginPage />);

    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /i've confirmed my email/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument();
  });

  it('restores an admin\'s step even with no session (admins never have one on this path)', async () => {
    mockGetSession.mockResolvedValue(null);
    savePendingLoginStep({ kind: 'email', match: ADMIN, value: 'sam@example.com' });
    render(<LoginPage />);

    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /i've confirmed my email/i })).toBeInTheDocument();
  });

  it('forgets the remembered screen once the typed code succeeds, so coming back to /login is not stuck on it', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { session: { access_token: 'tok' } }, error: null });
    mockGetSession.mockResolvedValue(null);
    savePendingLoginStep({ kind: 'mfa', match: { ...PLAIN, email: 'jack@example.com' } });
    render(<LoginPage />);

    fireEvent.click(await screen.findByRole('button', { name: /click here/i }));
    fireEvent.change(screen.getByLabelText(/code from the email/i), { target: { value: '12345678' } });
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/setup-mfa'));
    expect(mockVerifyOtp).toHaveBeenCalledWith({ email: 'jack@example.com', token: '12345678', type: 'email' });
    expect(readPendingLoginStep()).toBeNull();
  });
});
