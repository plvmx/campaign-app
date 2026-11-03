import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const mockGetSession = vi.fn();
vi.mock('@/lib/registrySupabaseClient', () => ({
  registrySupabase: { auth: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

const mockUseRegistryGate = vi.fn();
vi.mock('@/app/registry/useRegistryGate', () => ({
  useRegistryGate: (...args: unknown[]) => mockUseRegistryGate(...args),
}));

import RegistryManageRegistrationLogPage from '../page';
import type { RegistrationLogEntry } from '@/lib/registryPipeline/manageSummaryTypes';

// Synthetic people only.
const ENTRIES: RegistrationLogEntry[] = [
  {
    id: 3, receivedAt: '2026-10-31T12:00:00Z', listId: '1', outcome: 'returning_registrant',
    firstName: 'Ann', lastName: 'Example', email: 'ann@example.com', contactCreatedAt: '2025-08-19T00:00:00Z',
    registrant: { state: 'SA', registeredAt: '2025-08-20T00:00:00Z' },
  },
  {
    id: 2, receivedAt: '2026-10-31T04:00:00Z', listId: '2', outcome: 'responder',
    firstName: 'Bob', lastName: 'Sample', email: 'bob@example.com', contactCreatedAt: '2026-10-31T00:00:00Z', registrant: null,
  },
];

function installFetchMock(entries: RegistrationLogEntry[] = ENTRIES, totalCount = entries.length) {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ entries, totalCount }) }) as unknown as typeof fetch;
}

const adminGate = { status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } };

describe('RegistryManageRegistrationLogPage', () => {
  beforeEach(() => {
    mockGetSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'token-123' } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows a plain refusal to a state_leader, and never fetches', async () => {
    installFetchMock();
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'state_leader', mfa_required: false } });
    render(<RegistryManageRegistrationLogPage />);
    expect(await screen.findByText(/only available to national registry admins/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetches the registrations view, page 1, with the session token as a Bearer header', async () => {
    installFetchMock();
    mockUseRegistryGate.mockReturnValue(adminGate);
    render(<RegistryManageRegistrationLogPage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/registry/manage-registration-log?page=1&view=registrations',
      expect.objectContaining({ headers: { Authorization: 'Bearer token-123' } }),
    ));
  });

  it('explains a returning registrant and a responder in plain words', async () => {
    installFetchMock();
    mockUseRegistryGate.mockReturnValue(adminGate);
    render(<RegistryManageRegistrationLogPage />);

    expect(await screen.findByText('Ann Example (ann@example.com)')).toBeInTheDocument();
    expect(screen.getByText('Already registered — record updated')).toBeInTheDocument();
    expect(screen.getByText(/no new row was added/i)).toBeInTheDocument();
    expect(screen.getByText(/Way of Life responder \(kept separately/)).toBeInTheDocument();
  });

  it('reloads from page 1 with the chosen view', async () => {
    installFetchMock();
    mockUseRegistryGate.mockReturnValue(adminGate);
    render(<RegistryManageRegistrationLogPage />);
    await screen.findByText('Ann Example (ann@example.com)');

    fireEvent.change(screen.getByLabelText('Which submissions to show'), { target: { value: 'responders' } });
    await waitFor(() => expect(global.fetch).toHaveBeenLastCalledWith(
      '/api/registry/manage-registration-log?page=1&view=responders',
      expect.anything(),
    ));
  });

  it('searches by name or email and keeps the view', async () => {
    installFetchMock();
    mockUseRegistryGate.mockReturnValue(adminGate);
    render(<RegistryManageRegistrationLogPage />);
    await screen.findByText('Ann Example (ann@example.com)');

    fireEvent.change(screen.getByLabelText('Search by name or email'), { target: { value: 'ann' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(global.fetch).toHaveBeenLastCalledWith(
      '/api/registry/manage-registration-log?page=1&view=registrations&q=ann',
      expect.anything(),
    ));
  });

  it('shows an empty-state row when nothing matches', async () => {
    installFetchMock([], 0);
    mockUseRegistryGate.mockReturnValue(adminGate);
    render(<RegistryManageRegistrationLogPage />);
    expect(await screen.findAllByText('No matching submissions.')).not.toHaveLength(0);
  });

  it('shows the API error', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Failed to load the registration log' }) }) as unknown as typeof fetch;
    mockUseRegistryGate.mockReturnValue(adminGate);
    render(<RegistryManageRegistrationLogPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load the registration log');
  });
});
