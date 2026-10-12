/**
 * A leader reading the emailed code has to leave the app for their mail
 * program, and a phone browser often reloads /login when they come back.
 * /login used to find them already signed in and send them straight to /app —
 * so they never got to type the code (an iPhone leader, 2026-10-12). The
 * "Check your inbox" screen is now remembered (lib/pendingLoginStep.ts) and
 * restored on load instead of redirecting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, replace: vi.fn() }) }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/contexts/UserContext', () => ({ useUser: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: {}, from: vi.fn() } }));
vi.mock('@/lib/emailConfirmSupabaseClient', () => ({ emailConfirmSupabase: { auth: {} } }));

const mockGetSession = vi.fn();
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getSession: (...a: unknown[]) => mockGetSession(...a),
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
});
afterEach(() => cleanup());

describe('LoginPage — restoring "Check your inbox" after a reload', () => {
  it('puts a signed-in leader back on the email "Check your inbox" screen instead of sending them to /app', async () => {
    savePendingLoginStep({ kind: 'email', match: PLAIN, value: 'jack@example.com' });
    render(<LoginPage />);

    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
    expect(screen.getByText('jack@example.com')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does the same for the 2FA-setup "Check your inbox" screen', async () => {
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

  it('does not restore a plain leader\'s step when they are no longer signed in (its "skip" needs the session)', async () => {
    mockGetSession.mockResolvedValue(null);
    savePendingLoginStep({ kind: 'email', match: PLAIN, value: 'jack@example.com' });
    render(<LoginPage />);

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByText(/check your inbox/i)).not.toBeInTheDocument();
    expect(readPendingLoginStep()).toBeNull();
  });

  it('restores an admin\'s step even with no session (admins never have one on this path)', async () => {
    mockGetSession.mockResolvedValue(null);
    savePendingLoginStep({ kind: 'email', match: ADMIN, value: 'sam@example.com' });
    render(<LoginPage />);

    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /i've confirmed my email/i })).toBeInTheDocument();
  });
});
