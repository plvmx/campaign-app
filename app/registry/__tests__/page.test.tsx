import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('@/lib/registrySupabaseClient', () => ({
  registrySupabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { email: 'admin@example.com' } } }),
    },
  },
}));

vi.mock('@/lib/registryAuth', () => ({
  signOutOfRegistry: vi.fn(),
}));

const mockUseRegistryGate = vi.fn();
vi.mock('@/app/registry/useRegistryGate', () => ({
  useRegistryGate: (...args: unknown[]) => mockUseRegistryGate(...args),
}));

import RegistryHomePage from '../page';

describe('RegistryHomePage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the Manage button to a national_admin', async () => {
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryHomePage />);
    expect(await screen.findByRole('link', { name: 'Manage' })).toBeInTheDocument();
  });

  it('shows the Manage button to a whatsapp_admin', async () => {
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'whatsapp_admin', mfa_required: true } });
    render(<RegistryHomePage />);
    expect(await screen.findByRole('link', { name: 'Manage' })).toBeInTheDocument();
  });

  it('hides the Manage button from a state_leader', async () => {
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'state_leader', mfa_required: false } });
    render(<RegistryHomePage />);
    await screen.findByRole('link', { name: 'Recent Registrations' });
    expect(screen.queryByRole('link', { name: 'Manage' })).not.toBeInTheDocument();
  });
});
