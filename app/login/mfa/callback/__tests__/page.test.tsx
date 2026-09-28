/**
 * Mirrors app/setup-mfa/__tests__/page.test.tsx's sign-in-wait pattern
 * (SIGNED_IN event + getSession race-cover + give-up timeout) and
 * app/registry/mfa/challenge/__tests__/page.test.tsx's MFA-gate mechanics,
 * applied to state_leaders.user_id instead of registry.leader_roles.
 * completeLeaderAuthSignIn (lib/auth.ts) is exercised for real against the
 * mocked supabase client below, rather than mocked away, so this also
 * covers the user_roles delete-if-not-admin behavior directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

type AuthChangeCallback = (event: string, session: unknown) => void;

let authChangeCallback: AuthChangeCallback | null = null;
const mockUnsubscribe = vi.fn();
const mockOnAuthStateChange = vi.fn((cb: AuthChangeCallback) => {
  authChangeCallback = cb;
  return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
});
const mockGetSession = vi.fn();
const mockSignOut = vi.fn();
const mockGetAuthenticatorAssuranceLevel = vi.fn();
const mockListFactors = vi.fn();
const mockChallengeAndVerify = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: AuthChangeCallback) => mockOnAuthStateChange(cb),
      getSession: (...args: unknown[]) => mockGetSession(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      mfa: {
        getAuthenticatorAssuranceLevel: (...args: unknown[]) => mockGetAuthenticatorAssuranceLevel(...args),
        listFactors: (...args: unknown[]) => mockListFactors(...args),
        challengeAndVerify: (...args: unknown[]) => mockChallengeAndVerify(...args),
      },
    },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const mockRefreshUser = vi.fn();
vi.mock('@/contexts/UserContext', () => ({
  useUser: () => ({ refresh: mockRefreshUser }),
}));

import LoginMfaCallbackPage from '../page';

const SESSION = { user: { id: 'user-1' } };

function makeTableBuilder() {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  const chain = ['select', 'insert', 'update', 'upsert', 'delete', 'eq'];
  for (const method of chain) builder[method] = vi.fn().mockReturnValue(builder);
  (builder as unknown as PromiseLike<unknown>).then = ((onfulfilled?: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(onfulfilled)) as never;
  return builder as unknown as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<{ data: unknown; error: null }>;
}

let stateLeadersBuilder: ReturnType<typeof makeTableBuilder>;
let userProfilesBuilder: ReturnType<typeof makeTableBuilder>;
let userRolesBuilder: ReturnType<typeof makeTableBuilder>;

const SINGLE_ROW = [{ id: 'sl-1', state: 'VIC', leader: 'Peter', admin: null, mfa_enrolled_at: '2026-09-01T00:00:00Z' }];
const TWO_ROWS = [
  { id: 'sl-1', state: 'VIC', leader: 'Peter', admin: 'AD', mfa_enrolled_at: '2026-09-01T00:00:00Z' },
  { id: 'sl-2', state: 'QLD', leader: 'Peter', admin: 'SR', mfa_enrolled_at: '2026-09-01T00:00:00Z' },
];

async function signIn() {
  render(<LoginMfaCallbackPage />);
  await act(async () => { authChangeCallback!('SIGNED_IN', SESSION); });
}

describe('LoginMfaCallbackPage', () => {
  beforeEach(() => {
    authChangeCallback = null;
    mockOnAuthStateChange.mockClear();
    mockUnsubscribe.mockReset();
    mockGetSession.mockReset().mockResolvedValue({ data: { session: null } });
    mockSignOut.mockReset().mockResolvedValue({ error: null });
    mockGetAuthenticatorAssuranceLevel.mockReset().mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' } });
    mockListFactors.mockReset().mockResolvedValue({ data: { totp: [{ id: 'totp-factor-1', status: 'verified' }] } });
    mockChallengeAndVerify.mockReset().mockResolvedValue({ error: null });
    mockReplace.mockReset();
    mockRefreshUser.mockReset().mockResolvedValue(undefined);

    stateLeadersBuilder = makeTableBuilder();
    stateLeadersBuilder.select.mockReturnValue(stateLeadersBuilder);
    stateLeadersBuilder.eq.mockImplementation(() => Promise.resolve({ data: SINGLE_ROW, error: null }));
    userProfilesBuilder = makeTableBuilder();
    userRolesBuilder = makeTableBuilder();
    userRolesBuilder.eq.mockImplementation(() => Promise.resolve({ data: null, error: null }));

    mockFrom.mockReset().mockImplementation((table: string) => {
      if (table === 'state_leaders') return stateLeadersBuilder;
      if (table === 'user_profiles') return userProfilesBuilder;
      if (table === 'user_roles') return userRolesBuilder;
      throw new Error(`unexpected table: ${table}`);
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('gives up and shows "Back to sign in" if no session ever materializes', async () => {
    vi.useFakeTimers();
    render(<LoginMfaCallbackPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(screen.getByText(/link expired/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login/mfa');
  });

  it('shows the "not set up yet" fallback when no state_leaders row has mfa_enrolled_at', async () => {
    stateLeadersBuilder.eq.mockImplementation(() => Promise.resolve({ data: [], error: null }));
    await signIn();
    expect(await screen.findByText(/not set up yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
  });

  it('shows the "not set up yet" fallback when mfa_enrolled_at is set but no verified TOTP factor exists (data drift)', async () => {
    mockListFactors.mockResolvedValue({ data: { totp: [] } });
    await signIn();
    expect(await screen.findByText(/not set up yet/i)).toBeInTheDocument();
  });

  it('shows the authenticator challenge when the session is not yet at aal2', async () => {
    await signIn();
    expect(await screen.findByText(/enter your authenticator code/i)).toBeInTheDocument();
  });

  it('signs straight in (single row, no picker) after a successful challenge', async () => {
    await signIn();
    await screen.findByLabelText(/6-digit code/i);
    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }));

    await waitFor(() => expect(mockChallengeAndVerify).toHaveBeenCalledWith({ factorId: 'totp-factor-1', code: '123456' }));
    await waitFor(() => expect(userProfilesBuilder.upsert).toHaveBeenCalledWith(
      { user_id: 'user-1', name: 'Peter', state: 'VIC' },
      { onConflict: 'user_id' },
    ));
    await waitFor(() => expect(mockRefreshUser).toHaveBeenCalled());
    expect(mockReplace).toHaveBeenCalledWith('/app');
  });

  it('skips the challenge and goes straight to role resolution when already at aal2', async () => {
    mockGetAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' } });
    await signIn();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/app'));
    expect(mockListFactors).not.toHaveBeenCalled();
  });

  it('shows a role picker labeled by role when the user_id has more than one state_leaders row', async () => {
    stateLeadersBuilder.eq.mockImplementation(() => Promise.resolve({ data: TWO_ROWS, error: null }));
    await signIn();
    await screen.findByLabelText(/6-digit code/i);
    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }));

    expect(await screen.findByRole('button', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /State Reporter — QLD/ })).toBeInTheDocument();
  });

  it('grants admin (upserts user_roles) when the picked row is AD', async () => {
    stateLeadersBuilder.eq.mockImplementation(() => Promise.resolve({ data: TWO_ROWS, error: null }));
    await signIn();
    await screen.findByLabelText(/6-digit code/i);
    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }));

    fireEvent.click(await screen.findByRole('button', { name: 'Admin' }));

    await waitFor(() => expect(userRolesBuilder.upsert).toHaveBeenCalledWith({ user_id: 'user-1', role: 'admin' }, { onConflict: 'user_id' }));
    expect(userRolesBuilder.delete).not.toHaveBeenCalled();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/app'));
  });

  it('deletes any existing user_roles row (not left stale) when the picked row is not AD', async () => {
    stateLeadersBuilder.eq.mockImplementation(() => Promise.resolve({ data: TWO_ROWS, error: null }));
    await signIn();
    await screen.findByLabelText(/6-digit code/i);
    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }));

    fireEvent.click(await screen.findByRole('button', { name: /State Reporter — QLD/ }));

    await waitFor(() => expect(userRolesBuilder.delete).toHaveBeenCalled());
    expect(userRolesBuilder.upsert).not.toHaveBeenCalled();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/app'));
  });

  it('cancelling the challenge signs out and returns to /login/mfa', async () => {
    await signIn();
    await screen.findByLabelText(/6-digit code/i);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    expect(mockReplace).toHaveBeenCalledWith('/login/mfa');
  });
});
