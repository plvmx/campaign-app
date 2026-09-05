import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

const mockExchangeCodeForSession = vi.fn();
vi.mock('@/lib/registrySupabaseClient', () => ({
  registrySupabase: {
    auth: {
      exchangeCodeForSession: (...args: unknown[]) => mockExchangeCodeForSession(...args),
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

import RegistryAuthCallbackPage from '../page';

function setUrl(search: string) {
  window.history.pushState({}, '', `/registry/auth/callback${search}`);
}

describe('RegistryAuthCallbackPage', () => {
  beforeEach(() => {
    mockExchangeCodeForSession.mockReset();
    mockGetRegistryAccessState.mockReset();
    mockSetRegistryAuthCookie.mockReset();
    mockSetRegistrySessionCookie.mockReset();
    mockSignOutOfRegistry.mockReset();
    mockReplace.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('routes straight to /registry and sets the full session cookie when the gate is already clear', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null });
    mockGetRegistryAccessState.mockResolvedValue({ result: 'ok', leaderRole: { role: 'national_admin', mfa_required: true } });
    setUrl('?code=abc123');

    render(<RegistryAuthCallbackPage />);

    await waitFor(() => expect(mockSetRegistryAuthCookie).toHaveBeenCalled());
    await waitFor(() => expect(mockSetRegistrySessionCookie).toHaveBeenCalled());
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/registry'));
  });

  it('routes to MFA enrollment without setting the full session cookie', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null });
    mockGetRegistryAccessState.mockResolvedValue({ result: 'needs_enrollment', leaderRole: { role: 'national_admin', mfa_required: true } });
    setUrl('?code=abc123');

    render(<RegistryAuthCallbackPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/registry/mfa/enroll'));
    expect(mockSetRegistrySessionCookie).not.toHaveBeenCalled();
  });

  it('signs out and redirects to no-access when the account has no leader_roles row', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null });
    mockGetRegistryAccessState.mockResolvedValue({ result: 'no_access', leaderRole: null });
    setUrl('?code=abc123');

    render(<RegistryAuthCallbackPage />);

    await waitFor(() => expect(mockSignOutOfRegistry).toHaveBeenCalled());
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/registry/no-access'));
  });

  it('redirects to login with an error when the exchange fails, without checking access state', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: new Error('invalid code') });
    setUrl('?code=bad-code');

    render(<RegistryAuthCallbackPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/registry/login?error=auth_failed'));
    expect(mockGetRegistryAccessState).not.toHaveBeenCalled();
  });

  it('redirects to login without attempting an exchange when no code is present', async () => {
    setUrl('');

    render(<RegistryAuthCallbackPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/registry/login?error=auth_failed'));
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });
});
