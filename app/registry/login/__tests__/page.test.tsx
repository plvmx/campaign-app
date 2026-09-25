/**
 * The portal is invite-only (shouldCreateUser: false) — this form must
 * never reveal whether a submitted address is a recognized admin, so the
 * same "check your email" message has to show whether the sign-in request
 * actually succeeded or Supabase rejected the address outright.
 *
 * Also covers the existing-session check added 2026-09-25: the app's own
 * registry_session cookie can go missing (browser closed, a backgrounded
 * mobile tab evicted) well before the underlying Supabase session/refresh
 * token actually expires — this page used to show a blank sign-in form
 * regardless, so a still-signed-in leader would request a needless new
 * magic link. It now checks getRegistryAccessState() first.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const mockSignInWithOtp = vi.fn();
vi.mock('@/lib/registrySupabaseClient', () => ({
  registrySupabase: {
    auth: {
      signInWithOtp: (...args: unknown[]) => mockSignInWithOtp(...args),
    },
  },
}));

const mockGetRegistryAccessState = vi.fn();
const mockSetRegistryAuthCookie = vi.fn();
const mockSetRegistrySessionCookie = vi.fn();
const mockSignOutOfRegistry = vi.fn();
vi.mock('@/lib/registryAuth', () => ({
  getRegistryAccessState: (...args: unknown[]) => mockGetRegistryAccessState(...args),
  setRegistryAuthCookie: (...args: unknown[]) => mockSetRegistryAuthCookie(...args),
  setRegistrySessionCookie: (...args: unknown[]) => mockSetRegistrySessionCookie(...args),
  signOutOfRegistry: (...args: unknown[]) => mockSignOutOfRegistry(...args),
}));

const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

import RegistryLoginPage from '../page';

describe('RegistryLoginPage', () => {
  beforeEach(() => {
    mockSignInWithOtp.mockReset();
    mockGetRegistryAccessState.mockReset().mockResolvedValue({ result: 'unauthenticated', leaderRole: null });
    mockSetRegistryAuthCookie.mockReset();
    mockSetRegistrySessionCookie.mockReset();
    mockSignOutOfRegistry.mockReset();
    mockReplace.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the sign-in form once no existing session is found', async () => {
    render(<RegistryLoginPage />);
    await waitFor(() => expect(screen.getByLabelText(/email address/i)).toBeInTheDocument());
    expect(screen.getByText(/desktop or tablet/i)).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('requests an OTP with shouldCreateUser: false, scoped to the registry callback', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    render(<RegistryLoginPage />);
    await waitFor(() => expect(screen.getByLabelText(/email address/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'admin@afj.org.au' } });
    fireEvent.click(screen.getByRole('button', { name: /send magic link/i }));

    await waitFor(() => expect(mockSignInWithOtp).toHaveBeenCalledWith({
      email: 'admin@afj.org.au',
      options: expect.objectContaining({
        shouldCreateUser: false,
        emailRedirectTo: expect.stringContaining('/registry/auth/callback'),
      }),
    }));
  });

  it('shows the same generic confirmation when Supabase rejects the address (no enumeration)', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: { message: 'Signups not allowed for otp' } });
    render(<RegistryLoginPage />);
    await waitFor(() => expect(screen.getByLabelText(/email address/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'not-invited@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send magic link/i }));

    await waitFor(() => expect(screen.getByText(/check your email/i)).toBeInTheDocument());
    expect(screen.queryByText(/not allowed|error|invalid/i)).not.toBeInTheDocument();
  });

  it('shows the same generic confirmation on success too', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    render(<RegistryLoginPage />);
    await waitFor(() => expect(screen.getByLabelText(/email address/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'admin@afj.org.au' } });
    fireEvent.click(screen.getByRole('button', { name: /send magic link/i }));

    await waitFor(() => expect(screen.getByText(/check your email/i)).toBeInTheDocument());
  });

  it('carries a leader straight through to /registry when a valid session is already found (result: ok)', async () => {
    mockGetRegistryAccessState.mockResolvedValue({ result: 'ok', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryLoginPage />);

    await waitFor(() => expect(mockSetRegistrySessionCookie).toHaveBeenCalled());
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/registry'));
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
  });

  it('routes to the MFA challenge when a valid session still needs one', async () => {
    mockGetRegistryAccessState.mockResolvedValue({ result: 'needs_challenge', leaderRole: { role: 'state_leader', mfa_required: true } });
    render(<RegistryLoginPage />);

    await waitFor(() => expect(mockSetRegistryAuthCookie).toHaveBeenCalled());
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/registry/mfa/challenge'));
    expect(mockSetRegistrySessionCookie).not.toHaveBeenCalled();
  });

  it('signs out and redirects to no-access if the session belongs to an account with no leader_roles row', async () => {
    mockGetRegistryAccessState.mockResolvedValue({ result: 'no_access', leaderRole: null });
    render(<RegistryLoginPage />);

    await waitFor(() => expect(mockSignOutOfRegistry).toHaveBeenCalled());
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/registry/no-access'));
  });
});
