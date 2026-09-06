import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

const mockGetSession = vi.fn();
vi.mock('@/lib/registrySupabaseClient', () => ({
  registrySupabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

vi.mock('@/app/registry/useRegistryGate', () => ({
  useRegistryGate: () => ({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } }),
}));

import RecentRegistrationsPage from '../page';

const SAMPLE = [
  { firstName: 'Bob', lastName: 'Zeta', email: 'bob@example.com', phone: '+61400000001', state: 'NSW', postcode: '2000', registeredAt: '2026-08-25T00:00:00Z' },
  { firstName: 'Alice', lastName: 'Alpha', email: 'alice@example.com', phone: '+61400000002', state: 'VIC', postcode: '3000', registeredAt: '2026-08-30T00:00:00Z' },
];

describe('RecentRegistrationsPage', () => {
  beforeEach(() => {
    mockGetSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'token-123' } } });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ registrations: SAMPLE, cutoff: '2026-08-22T00:00:00Z' }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('fetches with the session access token as a Bearer header', async () => {
    render(<RecentRegistrationsPage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/registry/recent-registrations',
      expect.objectContaining({ headers: { Authorization: 'Bearer token-123' } }),
    ));
  });

  it('renders every fetched row', async () => {
    render(<RecentRegistrationsPage />);
    expect(await screen.findByText('bob@example.com')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });

  it('filters by search term across name and email', async () => {
    render(<RecentRegistrationsPage />);
    await screen.findByText('bob@example.com');

    fireEvent.change(screen.getByPlaceholderText(/search name or email/i), { target: { value: 'alice' } });

    expect(screen.queryByText('bob@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });

  it('filters by state', async () => {
    render(<RecentRegistrationsPage />);
    await screen.findByText('bob@example.com');

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'VIC' } });

    expect(screen.queryByText('bob@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });

  it('sorts by first name ascending/descending when the column header is clicked', async () => {
    render(<RecentRegistrationsPage />);
    await screen.findByText('bob@example.com');

    const rowsFirstNames = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);

    fireEvent.click(screen.getByText(/first name/i));
    expect(rowsFirstNames()).toEqual(['Alice', 'Bob']);

    fireEvent.click(screen.getByText(/first name/i));
    expect(rowsFirstNames()).toEqual(['Bob', 'Alice']);
  });

  it('shades each row with the same per-state color used on the campaign results slides', async () => {
    render(<RecentRegistrationsPage />);
    const bobRow = (await screen.findByText('bob@example.com')).closest('tr');
    const aliceRow = screen.getByText('alice@example.com').closest('tr');

    // NSW's slide color is rgb(0, 0, 0); VIC's is rgb(234, 107, 20) — see lib/slideLayout.ts.
    expect(bobRow).toHaveStyle({ backgroundColor: 'rgba(0, 0, 0, 0.14)' });
    expect(aliceRow).toHaveStyle({ backgroundColor: 'rgba(234, 107, 20, 0.14)' });
  });

  it('shows an error message when the API call fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Failed to fetch recent registrations from ActiveCampaign' }) }) as unknown as typeof fetch;
    render(<RecentRegistrationsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to fetch recent registrations/i);
  });
});
