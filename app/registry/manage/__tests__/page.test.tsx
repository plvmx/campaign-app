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

// The lookup dropdowns above the records table render every field value as
// an <option> too, so a bare `screen.getByText('vicky@example.com')` etc.
// is ambiguous once a cell is selected (it matches both the option and the
// table cell) — scope those queries to the table itself instead.
function recordsTable(): HTMLElement {
  return screen.getByRole('table', { name: 'Matching records' });
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
    isLeader: true, leaderName: 'Vicky Vale',
  },
  {
    id: 'r2', firstName: 'Nat', lastName: 'Nelson', email: 'nat@example.com', phone: '+61400000002',
    state: 'NSW', postcode: '2000', registeredAt: new Date(Date.now() - 20 * DAY).toISOString(),
    isLeader: false, leaderName: null,
  },
  {
    id: 'r3', firstName: 'Uma', lastName: 'Unknown', email: 'uma@example.com', phone: '+61400000003',
    state: null, postcode: null, registeredAt: new Date(Date.now() - 400 * DAY).toISOString(),
    isLeader: false, leaderName: null,
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

  it('links to the edit log', async () => {
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManagePage />);
    const link = await screen.findByRole('link', { name: /view edit log/i });
    expect(link).toHaveAttribute('href', '/registry/manage/edit-log');
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

  it('labels the registration-date column "Registered" and shows a date only, no time', async () => {
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManagePage />);
    const allRow = requireRow(await screen.findByText('All AFJ Registrations'));
    fireEvent.click(within(allRow).getByRole('button', { name: '3' }));

    const table = await screen.findByRole('table', { name: 'Matching records' });
    expect(within(table).getByText(/^Registered/)).toBeInTheDocument(); // may carry a sort indicator, e.g. "Registered ▼"
    expect(within(table).queryByText(/Date registered/)).not.toBeInTheDocument();

    const vickyRow = requireRow(within(table).getByText('vicky@example.com')) as HTMLTableRowElement;
    const dateCell = vickyRow.cells[vickyRow.cells.length - 1];
    expect(dateCell.textContent).toMatch(/^\d{1,2} [A-Za-z]+\.? \d{4}$/); // e.g. "10 Sept 2026" — no time component
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

    await screen.findByRole('table', { name: 'Matching records' });
    expect(within(recordsTable()).getByText('vicky@example.com')).toBeInTheDocument();
    expect(within(recordsTable()).queryByText('nat@example.com')).not.toBeInTheDocument();
    expect(screen.getByText(/All AFJ Registrations — VIC/)).toBeInTheDocument();

    // The clicked cell's shading intensifies (VIC's normal column tint is 0.14).
    const clickedCell = screen.getByRole('button', { name: '1', pressed: true }).closest('td');
    expect(clickedCell).toHaveStyle({ background: 'rgba(234, 107, 20, 0.45)' });
  });

  it('shows a leader icon next to the name of a registrant who matches a state_leaders row, and only that one', async () => {
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManagePage />);
    const allRow = requireRow(await screen.findByText('All AFJ Registrations'));
    fireEvent.click(within(allRow).getByRole('button', { name: '3' })); // Total — all three sample registrants

    const table = await screen.findByRole('table', { name: 'Matching records' });
    const icons = within(table).getAllByRole('img', { name: 'Registered as a state leader' });
    expect(icons).toHaveLength(1); // only Vicky is a leader

    const vickyRow = requireRow(within(table).getByText('vicky@example.com'));
    expect(within(vickyRow).getByRole('img', { name: 'Registered as a state leader' })).toHaveAttribute('title', 'Leader: Vicky Vale');
  });

  it('clears the record pane via "Clear selection"', async () => {
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManagePage />);
    const allRow = requireRow(await screen.findByText('All AFJ Registrations'));
    fireEvent.click(within(allRow).getAllByRole('button', { name: '1' })[0]);
    await screen.findByRole('table', { name: 'Matching records' });

    fireEvent.click(screen.getByText('Clear selection'));

    expect(screen.queryByRole('table', { name: 'Matching records' })).not.toBeInTheDocument();
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
    await screen.findByRole('table', { name: 'Matching records' });
    expect(within(recordsTable()).getByText('vicky@example.com')).toBeInTheDocument();
    expect(within(recordsTable()).queryByText('nat@example.com')).not.toBeInTheDocument();

    // Without re-clicking, widening the same dropdown to "Last month" should
    // pull Nat's 20-day-old registration into the still-open pane too.
    fireEvent.change(screen.getByLabelText('Primary Filter period'), { target: { value: 'last_month' } });
    await waitFor(() => expect(within(recordsTable()).getByText('nat@example.com')).toBeInTheDocument());
    expect(within(recordsTable()).getByText('vicky@example.com')).toBeInTheDocument();
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
      await screen.findByRole('table', { name: 'Matching records' });
    }

    it('defaults to View (plain text, no inputs)', async () => {
      installFetchMock();
      await selectAllVicCell();
      expect(screen.queryByLabelText('firstName')).not.toBeInTheDocument();
      expect(within(recordsTable()).getByText('Vicky')).toBeInTheDocument();
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
      expect(within(recordsTable()).getByText('vicky@example.com')).toBeInTheDocument();
      expect(within(recordsTable()).getByText('+61400000001')).toBeInTheDocument();
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

  describe('lookup filters', () => {
    // Selects "All AFJ Registrations" x Total — all three sample
    // registrants (Vicky, Nat, Uma), unfiltered by date or state.
    async function selectAllTotalCell() {
      mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
      render(<RegistryManagePage />);
      const allRow = requireRow(await screen.findByText('All AFJ Registrations'));
      fireEvent.click(within(allRow).getByRole('button', { name: '3' }));
      await screen.findByRole('table', { name: 'Matching records' });
    }

    it('populates each lookup dropdown from the distinct values actually present among the selected cell\'s records', async () => {
      await selectAllTotalCell();
      const options = screen.getByLabelText('Look up by First name').querySelectorAll('option');
      const values = Array.from(options).map((o) => o.textContent);
      expect(values).toEqual(['All', 'Nat', 'Uma', 'Vicky']);
    });

    it('narrows the shown records to an exact match when a lookup value is selected', async () => {
      await selectAllTotalCell();
      fireEvent.change(screen.getByLabelText('Look up by First name'), { target: { value: 'Vicky' } });

      expect(within(recordsTable()).getByText('vicky@example.com')).toBeInTheDocument();
      expect(within(recordsTable()).queryByText('nat@example.com')).not.toBeInTheDocument();
      expect(within(recordsTable()).queryByText('uma@example.com')).not.toBeInTheDocument();
    });

    it('combines multiple active lookups with AND', async () => {
      await selectAllTotalCell();
      fireEvent.change(screen.getByLabelText('Look up by First name'), { target: { value: 'Vicky' } });
      fireEvent.change(screen.getByLabelText('Look up by Postcode'), { target: { value: '2000' } }); // Nat's postcode, not Vicky's

      expect(within(recordsTable()).queryByText('vicky@example.com')).not.toBeInTheDocument();
      expect(screen.getByText(/\(0 of 3\)/)).toBeInTheDocument();
    });

    it('offers a "(blank)" option only for a field that actually has a blank value, and filtering by it isolates those records', async () => {
      await selectAllTotalCell();
      // Uma is the only sample registrant with no postcode.
      fireEvent.change(screen.getByLabelText('Look up by Postcode'), { target: { value: '__blank__' } });
      expect(within(recordsTable()).getByText('uma@example.com')).toBeInTheDocument();
      expect(within(recordsTable()).queryByText('vicky@example.com')).not.toBeInTheDocument();

      // Every sample registrant has an email — no "(blank)" option should exist for that field.
      const emailOptionLabels = Array.from(screen.getByLabelText('Look up by Email').querySelectorAll('option')).map((o) => o.textContent);
      expect(emailOptionLabels).not.toContain('(blank)');
    });

    it('shows "Reset lookups" only once a lookup is active, and it restores the full list', async () => {
      await selectAllTotalCell();
      expect(screen.queryByText('Reset lookups')).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Look up by First name'), { target: { value: 'Vicky' } });
      expect(within(recordsTable()).queryByText('nat@example.com')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('Reset lookups'));
      expect(screen.getByLabelText('Look up by First name')).toHaveValue('');
      expect(within(recordsTable()).getByText('nat@example.com')).toBeInTheDocument();
    });

    it('resets active lookups when a different cell is selected', async () => {
      await selectAllTotalCell();
      fireEvent.change(screen.getByLabelText('Look up by First name'), { target: { value: 'Vicky' } });
      expect(screen.getByLabelText('Look up by First name')).toHaveValue('Vicky');

      const primaryRow = requireRow(screen.getByLabelText('Primary Filter period'));
      fireEvent.click(within(primaryRow).getAllByRole('button', { name: '1' })[0]);

      await screen.findByText(/Primary Filter — Total/);
      expect(screen.getByLabelText('Look up by First name')).toHaveValue('');
    });
  });

  describe('sorting the record pane', () => {
    // Selects "All AFJ Registrations" x Total — all three sample
    // registrants (Vicky/VIC/3000, Nat/NSW/2000, Uma/null-state/null-postcode).
    async function selectAllTotalCell() {
      mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
      render(<RegistryManagePage />);
      const allRow = requireRow(await screen.findByText('All AFJ Registrations'));
      fireEvent.click(within(allRow).getByRole('button', { name: '3' }));
      await screen.findByRole('table', { name: 'Matching records' });
    }

    it('sorts by First name ascending on first click, and reverses on a second click of the same header', async () => {
      await selectAllTotalCell();
      const table = recordsTable();

      fireEvent.click(within(table).getByText(/First name/));
      expect(within(table).getByText('First name ▲')).toBeInTheDocument();
      const asc = table.textContent ?? '';
      expect(asc.indexOf('Nat')).toBeLessThan(asc.indexOf('Uma'));
      expect(asc.indexOf('Uma')).toBeLessThan(asc.indexOf('Vicky'));

      fireEvent.click(within(table).getByText(/First name/));
      expect(within(table).getByText('First name ▼')).toBeInTheDocument();
      const desc = table.textContent ?? '';
      expect(desc.indexOf('Vicky')).toBeLessThan(desc.indexOf('Uma'));
      expect(desc.indexOf('Uma')).toBeLessThan(desc.indexOf('Nat'));
    });

    it('sorts by Last name', async () => {
      await selectAllTotalCell();
      const table = recordsTable();

      fireEvent.click(within(table).getByText(/Last name/));
      const asc = table.textContent ?? '';
      expect(asc.indexOf('Nelson')).toBeLessThan(asc.indexOf('Unknown'));
      expect(asc.indexOf('Unknown')).toBeLessThan(asc.indexOf('Vale'));
    });

    it('sorts by Postcode, with a blank postcode sorting first ascending', async () => {
      await selectAllTotalCell();
      const table = recordsTable();

      fireEvent.click(within(table).getByText(/Postcode/));
      const asc = table.textContent ?? '';
      expect(asc.indexOf('uma@example.com')).toBeLessThan(asc.indexOf('nat@example.com')); // null postcode
      expect(asc.indexOf('nat@example.com')).toBeLessThan(asc.indexOf('vicky@example.com')); // 2000 < 3000
    });

    it('sorts by Registered date, defaulting to newest-first with a visible indicator', async () => {
      await selectAllTotalCell();
      const table = recordsTable();

      // Default state: registeredAt desc (newest first) — the indicator
      // shows this from the start, even before any header is clicked.
      expect(within(table).getByText('Registered ▼')).toBeInTheDocument();
      const initial = table.textContent ?? '';
      expect(initial.indexOf('vicky@example.com')).toBeLessThan(initial.indexOf('nat@example.com'));
      expect(initial.indexOf('nat@example.com')).toBeLessThan(initial.indexOf('uma@example.com'));

      fireEvent.click(within(table).getByText(/Registered/));
      expect(within(table).getByText('Registered ▲')).toBeInTheDocument();
      const asc = table.textContent ?? '';
      expect(asc.indexOf('uma@example.com')).toBeLessThan(asc.indexOf('nat@example.com'));
      expect(asc.indexOf('nat@example.com')).toBeLessThan(asc.indexOf('vicky@example.com'));
    });

    it('does not make Email, Mobile, or State clickable/sortable', async () => {
      await selectAllTotalCell();
      const table = recordsTable();
      for (const header of ['Email', 'Mobile', 'State']) {
        expect(within(table).getByText(header)).not.toHaveStyle({ cursor: 'pointer' });
      }
    });
  });
});
