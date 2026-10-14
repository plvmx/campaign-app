/**
 * A phone kept a saved session that Supabase's server no longer accepted
 * (Peter_AD, 2026-10-14). /login trusted the saved copy and sent it to /app;
 * /app's own server check rejected it and sent it back to /login — round and
 * round, stuck on "Checking sign-in status…". /login now asks the server
 * (getVerifiedSession) before redirecting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const mockPush = vi.fn();
const mockRouter = { push: mockPush, replace: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/contexts/UserContext', () => ({ useUser: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: {}, from: vi.fn() } }));
vi.mock('@/lib/emailConfirmSupabaseClient', () => ({ emailConfirmSupabase: { auth: {} } }));

// The saved copy on the device still looks signed in; the server says no.
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getSession: vi.fn().mockResolvedValue({ user: { id: 'banned-anon' } }),
  getVerifiedSession: vi.fn().mockResolvedValue(null),
}));

import LoginPage from '../page';

beforeEach(() => {
  localStorage.clear();
  mockPush.mockReset();
});
afterEach(() => cleanup());

describe('LoginPage — a saved session the server has rejected', () => {
  it('shows the sign-in form instead of sending it to /app', async () => {
    render(<LoginPage />);
    expect(await screen.findByLabelText(/mobile number/i)).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalledWith('/app');
  });
});
