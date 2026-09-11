import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const mockGetSession = vi.fn();
vi.mock('@/lib/registrySupabaseClient', () => ({
  registrySupabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

const mockUseRegistryGate = vi.fn();
vi.mock('@/app/registry/useRegistryGate', () => ({
  useRegistryGate: (...args: unknown[]) => mockUseRegistryGate(...args),
}));

import RegistryManageEditLogPage from '../page';
import type { RegistrantEditLogEntry } from '@/lib/registryPipeline/manageSummaryTypes';

const PAGE_1_ENTRIES: RegistrantEditLogEntry[] = [
  {
    id: 3, field: 'state', oldValue: null, newValue: 'NSW', editedByEmail: 'admin@example.com', editedAt: '2026-09-11T02:00:00Z',
    registrant: { firstName: 'Vicky', lastName: 'Vale', email: 'vicky@example.com', state: 'NSW' },
  },
  {
    id: 2, field: 'postcode', oldValue: '3000', newValue: '3141', editedByEmail: 'admin@example.com', editedAt: '2026-09-11T01:00:00Z',
    registrant: { firstName: 'Vicky', lastName: 'Vale', email: 'vicky@example.com', state: 'VIC' },
  },
];

function installFetchMock(overrides: Partial<{ entries: RegistrantEditLogEntry[]; totalCount: number }> = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ entries: overrides.entries ?? PAGE_1_ENTRIES, totalCount: overrides.totalCount ?? PAGE_1_ENTRIES.length }),
  }) as unknown as typeof fetch;
}

describe('RegistryManageEditLogPage', () => {
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
    render(<RegistryManageEditLogPage />);
    expect(await screen.findByText(/only available to national registry admins/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetches page 1 with the session access token as a Bearer header', async () => {
    installFetchMock();
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManageEditLogPage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/registry/manage-edit-log?page=1',
      expect.objectContaining({ headers: { Authorization: 'Bearer token-123' } }),
    ));
  });

  it('renders each entry with its registrant, field label, old/new values, and editor', async () => {
    installFetchMock();
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManageEditLogPage />);

    expect(await screen.findByText('State')).toBeInTheDocument(); // field label, not the raw 'state' column name
    expect(screen.getByText('Postcode')).toBeInTheDocument();
    expect(screen.getAllByText('Vicky Vale (vicky@example.com)').length).toBeGreaterThan(0);
    expect(screen.getByText('3141')).toBeInTheDocument();
    expect(screen.getByText('3000')).toBeInTheDocument();
    expect(screen.getAllByText('admin@example.com').length).toBeGreaterThan(0);
  });

  it('shows an em dash for a null old value (e.g. a field that had never been set before)', async () => {
    installFetchMock();
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManageEditLogPage />);
    await screen.findByText('NSW');
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('falls back to "Unknown registrant" when the joined registrant is null', async () => {
    installFetchMock({
      entries: [{ id: 9, field: 'first_name', oldValue: 'Bob', newValue: 'Robert', editedByEmail: null, editedAt: '2026-09-11T00:00:00Z', registrant: null }],
      totalCount: 1,
    });
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManageEditLogPage />);
    expect(await screen.findByText('Unknown registrant')).toBeInTheDocument();
  });

  it('pages forward and back, refetching each time', async () => {
    installFetchMock({ totalCount: 120 }); // 3 pages at PAGE_SIZE 50
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManageEditLogPage />);
    await screen.findByText('1 / 3');

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/registry/manage-edit-log?page=2',
      expect.anything(),
    ));
    await screen.findByText('2 / 3');

    fireEvent.click(screen.getByRole('button', { name: /prev/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/registry/manage-edit-log?page=1',
      expect.anything(),
    ));
  });

  it('shows a "no edits recorded" message rather than an empty table when there are none', async () => {
    installFetchMock({ entries: [], totalCount: 0 });
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManageEditLogPage />);
    expect(await screen.findByText('No edits recorded yet.')).toBeInTheDocument();
  });
});
