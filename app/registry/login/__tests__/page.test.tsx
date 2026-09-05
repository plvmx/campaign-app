/**
 * The portal is invite-only (shouldCreateUser: false) — this form must
 * never reveal whether a submitted address is a recognized admin, so the
 * same "check your email" message has to show whether the sign-in request
 * actually succeeded or Supabase rejected the address outright.
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

import RegistryLoginPage from '../page';

describe('RegistryLoginPage', () => {
  beforeEach(() => {
    mockSignInWithOtp.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('requests an OTP with shouldCreateUser: false, scoped to the registry callback', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    render(<RegistryLoginPage />);

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

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'not-invited@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send magic link/i }));

    await waitFor(() => expect(screen.getByText(/check your email/i)).toBeInTheDocument());
    expect(screen.queryByText(/not allowed|error|invalid/i)).not.toBeInTheDocument();
  });

  it('shows the same generic confirmation on success too', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    render(<RegistryLoginPage />);

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'admin@afj.org.au' } });
    fireEvent.click(screen.getByRole('button', { name: /send magic link/i }));

    await waitFor(() => expect(screen.getByText(/check your email/i)).toBeInTheDocument());
  });
});
