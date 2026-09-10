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

import RegistryManagePage from '../page';

function requireRow(el: HTMLElement): HTMLElement {
  const row = el.closest('tr');
  if (!row) throw new Error('Expected element to be inside a <tr>');
  return row;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// One recent (within the last 7 days), one mid-range (within the last
// month but outside the last 7 days), one old + state-less (only shows
// up in the unfiltered "All AFJ Registrations" row's Unknown column).
const SAMPLE_REGISTRANTS = [
  { state: 'VIC', registeredAt: new Date(Date.now() - HOUR).toISOString() },
  { state: 'NSW', registeredAt: new Date(Date.now() - 20 * DAY).toISOString() },
  { state: null, registeredAt: new Date(Date.now() - 400 * DAY).toISOString() },
];

describe('RegistryManagePage', () => {
  beforeEach(() => {
    mockGetSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'token-123' } } });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        lastSync: { startedAt: '2026-09-10T03:00:00Z', completedAt: '2026-09-10T03:01:00Z', status: 'success', recordsIn: 5, recordsUpserted: 5, errors: 0, notes: null },
        registrants: SAMPLE_REGISTRANTS,
      }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows a plain refusal to a state_leader, and never fetches the summary', async () => {
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'state_leader', mfa_required: false } });
    render(<RegistryManagePage />);
    expect(await screen.findByText(/only available to national registry admins/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetches with the session access token as a Bearer header for a national_admin', async () => {
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManagePage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/registry/manage-summary',
      expect.objectContaining({ headers: { Authorization: 'Bearer token-123' } }),
    ));
  });

  it('allows a whatsapp_admin in too', async () => {
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'whatsapp_admin', mfa_required: true } });
    render(<RegistryManagePage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  });

  it('shows the last cron run time and outcome', async () => {
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManagePage />);
    expect(await screen.findByText(/Last cron run:/)).toBeInTheDocument();
    expect(screen.getByText('Completed successfully')).toBeInTheDocument();
  });

  it('renders the unfiltered total row across every registrant, regardless of date', async () => {
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManagePage />);
    const row = requireRow(await screen.findByText('All AFJ Registrations'));
    expect(row).toHaveTextContent(/3/); // total
  });

  it('updates the Primary Filter row counts when a different period is selected', async () => {
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManagePage />);
    await screen.findByText('All AFJ Registrations');

    // Default "Last 7 days" only catches the 1-hour-old VIC registrant.
    const primaryRow = requireRow(screen.getByLabelText('Primary Filter period'));
    expect(primaryRow).toHaveTextContent('1');

    // Switching to "Last month" also picks up the 20-day-old NSW registrant.
    fireEvent.change(screen.getByLabelText('Primary Filter period'), { target: { value: 'last_month' } });
    await waitFor(() => expect(primaryRow).toHaveTextContent('2'));
  });
});
