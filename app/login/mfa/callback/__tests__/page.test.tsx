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

const originalFetch = global.fetch;

async function signIn() {
  // completeLeaderAuthSignIn() reads the live session's access token to call
  // the server-side grant route.
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok-abc', user: { id: 'user-1' } } } });
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
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
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
    global.fetch = originalFetch;
    cleanup();
    vi.useRealTimers();
  });

  it('gives up and shows "Back to sign in" if no session ever materializes', async () => {
    vi.useFakeTimers();
    render(<LoginMfaCallbackPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(screen.getByText(/that link has already been used/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login/mfa');
  });

  it('shows the "not set up yet" fallback when no state_leaders row has mfa_enrolled_at', async () => {
    stateLeadersBuilder.eq.mockImplementation(() => Promise.resolve({ data: [], error: null }));
    await signIn();
    expect(await screen.findByText(/not set up yet/i)).toBeInTheDocument();
    // The way out must go to the mobile+name form, not bare /login, which a device that remembers
    // email sign-in would redirect straight back here (PVTester stuck after a 2FA reset, 2026-10-14).
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login?mode=mobile');
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
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/grant-session-access',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok-abc' }),
        body: JSON.stringify({ method: 'real-auth', leaderId: 'sl-1' }),
      }),
    ));
    // The browser must no longer write these itself — user_roles is
    // service-role-only now (see lib/services/sessionAccessService.ts).
    expect(userProfilesBuilder.upsert).not.toHaveBeenCalled();
    expect(userRolesBuilder.upsert).not.toHaveBeenCalled();
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

  it('asks the server to grant the picked AD row — the browser itself never writes user_roles', async () => {
    stateLeadersBuilder.eq.mockImplementation(() => Promise.resolve({ data: TWO_ROWS, error: null }));
    await signIn();
    await screen.findByLabelText(/6-digit code/i);
    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }));

    fireEvent.click(await screen.findByRole('button', { name: 'Admin' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/grant-session-access',
      expect.objectContaining({ body: JSON.stringify({ method: 'real-auth', leaderId: 'sl-1' }) }),
    ));
    expect(userRolesBuilder.upsert).not.toHaveBeenCalled();
    expect(userRolesBuilder.delete).not.toHaveBeenCalled();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/app'));
  });

  it('asks the server to grant the picked non-AD row (the server clears any stale admin role)', async () => {
    stateLeadersBuilder.eq.mockImplementation(() => Promise.resolve({ data: TWO_ROWS, error: null }));
    await signIn();
    await screen.findByLabelText(/6-digit code/i);
    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }));

    fireEvent.click(await screen.findByRole('button', { name: /State Reporter — QLD/ }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/grant-session-access',
      expect.objectContaining({ body: JSON.stringify({ method: 'real-auth', leaderId: 'sl-2' }) }),
    ));
    expect(userRolesBuilder.delete).not.toHaveBeenCalled();
    expect(userRolesBuilder.upsert).not.toHaveBeenCalled();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/app'));
  });

  it('shows an error and does not navigate on if the server refuses the grant', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Not authorised for this leader' }) });
    await signIn();
    await screen.findByLabelText(/6-digit code/i);
    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be verified/i);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockRefreshUser).not.toHaveBeenCalled();
  });

  it('shows the error (not a frozen "Signing you in…") when the server refuses a sign-in that needed no challenge', async () => {
    mockGetAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' } });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Not authorised for this leader' }) });
    await signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be verified/i);
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login/mfa');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('offers a way out instead of freezing on "Signing you in…" if a step never finishes', async () => {
    vi.useFakeTimers();
    stateLeadersBuilder.eq.mockImplementation(() => new Promise(() => {}));
    render(<LoginMfaCallbackPage />);
    await act(async () => { authChangeCallback!('SIGNED_IN', SESSION); });
    expect(screen.getByText(/signing you in/i)).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(screen.getByText(/taking too long/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start again/i })).toHaveAttribute('href', '/login/mfa');
  });

  it('cancelling the challenge signs out and returns to /login/mfa', async () => {
    await signIn();
    await screen.findByLabelText(/6-digit code/i);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    expect(mockReplace).toHaveBeenCalledWith('/login/mfa');
  });
});
