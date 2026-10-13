/**
 * Plain leaders (not AD/SR) used to be asked, skippably, to confirm an email
 * and set up 2FA at every sign-in. Now they are not asked at all at a normal
 * sign-in — 2FA is only required to see other people's personal details
 * (components/auth/RequireTwoFactorForMemberDetails.tsx), which sends them to
 * /login?require2fa=1, where they get the same no-skip steps an admin does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const mockPush = vi.fn();
const mockRouter = { push: mockPush, replace: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/contexts/UserContext', () => ({ useUser: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: {}, from: vi.fn() } }));
vi.mock('@/lib/emailConfirmSupabaseClient', () => ({ emailConfirmSupabase: { auth: {} } }));
vi.mock('@/lib/services/campaignService', () => ({ getRecentTWOLCampaignsForLeader: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/services/trainingInterestService', () => ({ getTrainingCampaigns: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/services/campaignInterestService', () => ({ hasCampaignInterestForLeader: vi.fn().mockResolvedValue(true) }));

const mockValidate = vi.fn();
const mockCompleteSignIn = vi.fn();
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getSession: vi.fn().mockResolvedValue(null),
  validateStateLeader: (...a: unknown[]) => mockValidate(...a),
  completeSignIn: (...a: unknown[]) => mockCompleteSignIn(...a),
}));

import LoginPage from '../page';
import type { StateLeaderMatch } from '@/lib/auth';

const PLAIN: StateLeaderMatch = {
  id: 'sl-1', state: 'NSW', leader: 'Jack', mobile: '0400000000', admin: null,
  email: null, pendingEmail: null, suggestedEmail: 'jack@example.com', mfaEnrolledAt: null,
};

function stubSearch(search: string) {
  window.history.replaceState({}, '', `/login${search}`);
}

async function submitCredentials() {
  fireEvent.change(await screen.findByPlaceholderText('e.g., 0429 028 464'), { target: { value: '0400000000' } });
  fireEvent.change(screen.getByPlaceholderText('Enter your first name'), { target: { value: 'Jack' } });
  fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
}

beforeEach(() => {
  localStorage.clear();
  mockPush.mockReset();
  mockValidate.mockReset().mockResolvedValue([PLAIN]);
  mockCompleteSignIn.mockReset().mockResolvedValue({});
});
afterEach(() => { cleanup(); stubSearch(''); });

describe('LoginPage — plain leaders and two-factor authentication', () => {
  it('signs a plain leader straight in with no email or 2FA prompt at a normal sign-in', async () => {
    stubSearch('');
    render(<LoginPage />);
    await submitCredentials();

    expect(await screen.findByText(/what do you want to do today/i)).toBeInTheDocument();
    expect(mockCompleteSignIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/add your email/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument();
  });

  it('under ?require2fa=1 it does NOT sign them in with mobile+name — it starts the no-skip email step instead', async () => {
    stubSearch('?require2fa=1');
    render(<LoginPage />);
    expect(await screen.findByText(/needed to see other people.s personal details/i)).toBeInTheDocument();
    await submitCredentials();

    expect(await screen.findByText(/add your email/i)).toBeInTheDocument();
    expect(mockCompleteSignIn).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument();
  });

  it('under ?require2fa=1 an already-enrolled leader is sent to email sign-in, not signed in with mobile+name', async () => {
    mockValidate.mockResolvedValue([{ ...PLAIN, email: 'jack@example.com', mfaEnrolledAt: '2026-10-01T00:00:00Z' }]);
    stubSearch('?require2fa=1');
    render(<LoginPage />);
    await submitCredentials();

    expect(await screen.findByRole('heading', { name: /sign in with your email/i })).toBeInTheDocument();
    expect(mockCompleteSignIn).not.toHaveBeenCalled();
  });
});
