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
  {
    id: 'r1', firstName: 'Vicky', lastName: 'Vale', email: 'vicky@example.com', phone: '+61400000001',
    state: 'VIC', postcode: '3000', registeredAt: new Date(Date.now() - HOUR).toISOString(),
  },
  {
    id: 'r2', firstName: 'Nat', lastName: 'Nelson', email: 'nat@example.com', phone: '+61400000002',
    state: 'NSW', postcode: '2000', registeredAt: new Date(Date.now() - 20 * DAY).toISOString(),
  },
  {
    id: 'r3', firstName: 'Uma', lastName: 'Unknown', email: 'uma@example.com', phone: '+61400000003',
    state: null, postcode: null, registeredAt: new Date(Date.now() - 400 * DAY).toISOString(),
  },
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

  it('shows no record pane, and plain "0" text (not a button), for every zero-count cell', async () => {
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManagePage />);
    const allRow = requireRow(await screen.findByText('All AFJ Registrations'));
    // ACT/QLD/NT/WA/SA/TAS all have no registrants in the sample data — none of those cells should be clickable.
    for (const zeroCell of within(allRow).getAllByText('0')) {
      expect(zeroCell.tagName).not.toBe('BUTTON');
    }
    expect(screen.getByText(/click a number above/i)).toBeInTheDocument();
  });

  it('lists the matching records and highlights the clicked cell when a non-zero number is clicked', async () => {
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManagePage />);
    const allRow = requireRow(await screen.findByText('All AFJ Registrations'));

    // "All AFJ Registrations" x VIC = 1 (Vicky Vale, unfiltered). Total is 3,
    // so VIC and NSW are the only two "1" cells in this row — VIC comes
    // first (column order: Total, VIC, NSW, ...).
    fireEvent.click(within(allRow).getAllByRole('button', { name: '1' })[0]);

    expect(await screen.findByText('vicky@example.com')).toBeInTheDocument();
    expect(screen.queryByText('nat@example.com')).not.toBeInTheDocument();
    expect(screen.getByText(/All AFJ Registrations — VIC/)).toBeInTheDocument();

    // The clicked cell's shading intensifies (VIC's normal column tint is 0.14).
    const clickedCell = screen.getByRole('button', { name: '1', pressed: true }).closest('td');
    expect(clickedCell).toHaveStyle({ background: 'rgba(234, 107, 20, 0.45)' });
  });

  it('clears the record pane via "Clear selection"', async () => {
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManagePage />);
    const allRow = requireRow(await screen.findByText('All AFJ Registrations'));
    fireEvent.click(within(allRow).getAllByRole('button', { name: '1' })[0]);
    await screen.findByText('vicky@example.com');

    fireEvent.click(screen.getByText('Clear selection'));

    expect(screen.queryByText('vicky@example.com')).not.toBeInTheDocument();
    expect(screen.getByText(/click a number above/i)).toBeInTheDocument();
  });

  it('re-filters the record pane live when the selected row\'s own period dropdown changes', async () => {
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManagePage />);
    await screen.findByText('All AFJ Registrations');

    // Primary Filter x Total, default "Last 7 days": only Vicky (1 hour ago)
    // — Total and VIC are both "1" here too; Total is the first (leftmost).
    const primaryRow = requireRow(screen.getByLabelText('Primary Filter period'));
    fireEvent.click(within(primaryRow).getAllByRole('button', { name: '1' })[0]);
    expect(await screen.findByText('vicky@example.com')).toBeInTheDocument();
    expect(screen.queryByText('nat@example.com')).not.toBeInTheDocument();

    // Without re-clicking, widening the same dropdown to "Last month" should
    // pull Nat's 20-day-old registration into the still-open pane too.
    fireEvent.change(screen.getByLabelText('Primary Filter period'), { target: { value: 'last_month' } });
    await waitFor(() => expect(screen.getByText('nat@example.com')).toBeInTheDocument());
    expect(screen.getByText('vicky@example.com')).toBeInTheDocument();
  });

  describe('editing records', () => {
    function installFetchMock({ patchOk = true, patchError = 'Failed to save.' }: { patchOk?: boolean; patchError?: string } = {}) {
      global.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          const body = JSON.parse(String(init.body));
          if (!patchOk) {
            return { ok: false, json: async () => ({ error: patchError }) };
          }
          return { ok: true, json: async () => ({ id: body.id, field: body.field, value: body.value }) };
        }
        return {
          ok: true,
          json: async () => ({
            lastSync: { startedAt: '2026-09-10T03:00:00Z', completedAt: '2026-09-10T03:01:00Z', status: 'success', recordsIn: 5, recordsUpserted: 5, errors: 0, notes: null },
            registrants: SAMPLE_REGISTRANTS,
          }),
        };
      }) as unknown as typeof fetch;
    }

    // Selects "All AFJ Registrations" x VIC (Vicky Vale — id r1) — every
    // edit test starts from here.
    async function selectAllVicCell() {
      mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
      render(<RegistryManagePage />);
      const allRow = requireRow(await screen.findByText('All AFJ Registrations'));
      fireEvent.click(within(allRow).getAllByRole('button', { name: '1' })[0]);
      await screen.findByText('vicky@example.com');
    }

    it('defaults to View (plain text, no inputs)', async () => {
      installFetchMock();
      await selectAllVicCell();
      expect(screen.queryByLabelText('firstName')).not.toBeInTheDocument();
      expect(screen.getByText('Vicky')).toBeInTheDocument();
    });

    it('in Edit mode, First/Last/State/Postcode become inputs but Email/Mobile/Date registered never do', async () => {
      installFetchMock();
      await selectAllVicCell();

      fireEvent.click(screen.getByLabelText('Edit'));

      expect(await screen.findByLabelText('firstName')).toHaveValue('Vicky');
      expect(screen.getByLabelText('lastName')).toHaveValue('Vale');
      expect(screen.getByLabelText('state')).toHaveValue('VIC');
      expect(screen.getByLabelText('postcode')).toHaveValue('3000');
      // Still plain text — never rendered as an input, in either mode.
      expect(screen.getByText('vicky@example.com')).toBeInTheDocument();
      expect(screen.getByText('+61400000001')).toBeInTheDocument();
    });

    it('saves a text field edit on blur, with the field/value the input actually held', async () => {
      installFetchMock();
      await selectAllVicCell();
      fireEvent.click(screen.getByLabelText('Edit'));

      const postcodeInput = await screen.findByLabelText('postcode');
      fireEvent.change(postcodeInput, { target: { value: '3141' } });
      fireEvent.blur(postcodeInput);

      await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
        '/api/registry/manage-record',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ id: 'r1', field: 'postcode', value: '3141' }),
        }),
      ));
    });

    it('does not re-save on blur when the value was not actually changed', async () => {
      installFetchMock();
      await selectAllVicCell();
      fireEvent.click(screen.getByLabelText('Edit'));

      const fetchCallsBefore = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
      fireEvent.blur(await screen.findByLabelText('firstName'));

      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fetchCallsBefore);
    });

    it('moves a registrant between grid columns live when a corrected state is saved', async () => {
      installFetchMock();
      await selectAllVicCell();
      fireEvent.click(screen.getByLabelText('Edit'));

      fireEvent.change(await screen.findByLabelText('state'), { target: { value: 'NSW' } });

      // Vicky was VIC's only registrant; correcting her to NSW should give
      // "All AFJ Registrations" 0 VIC and 2 NSW (Nat + the corrected Vicky).
      const allRow = requireRow(screen.getByText('All AFJ Registrations'));
      await waitFor(() => expect(within(allRow).getAllByText('0').length).toBeGreaterThan(0));
      expect(within(allRow).getAllByRole('button', { name: '2' })[0]).toBeInTheDocument();
    });

    it('shows an inline error and reverts the value when the save is rejected', async () => {
      installFetchMock({ patchOk: false, patchError: 'Invalid value for postcode' });
      await selectAllVicCell();
      fireEvent.click(screen.getByLabelText('Edit'));

      const postcodeInput = await screen.findByLabelText('postcode');
      fireEvent.change(postcodeInput, { target: { value: 'bad' } });
      fireEvent.blur(postcodeInput);

      expect(await screen.findByText('Invalid value for postcode')).toBeInTheDocument();
      await waitFor(() => expect(postcodeInput).toHaveValue('3000'));
    });

    it('resets to View mode when a different cell is selected', async () => {
      installFetchMock();
      await selectAllVicCell();
      fireEvent.click(screen.getByLabelText('Edit'));
      await screen.findByLabelText('firstName');

      const primaryRow = requireRow(screen.getByLabelText('Primary Filter period'));
      fireEvent.click(within(primaryRow).getAllByRole('button', { name: '1' })[0]);

      await screen.findByText(/Primary Filter — Total/);
      expect(screen.queryByLabelText('firstName')).not.toBeInTheDocument();
    });
  });
});
