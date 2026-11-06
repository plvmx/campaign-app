import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: {}, from: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('id=c1&returnFilter=past'),
}));
vi.mock('@/components/MobileLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/contexts/UserContext', () => ({
  useUser: () => ({ user: { id: 'u1' }, adminStatus: 'AD', isLoading: false }),
}));
vi.mock('@/lib/services/campaignService', () => ({
  getCampaignById: vi.fn().mockResolvedValue({
    id: 'c1', date: '2026-10-31', state: 'VIC', place: 'Orange', site: '1', time: '10:00', leader: 'Jane Smith',
  }),
}));

const requestEmail = vi.fn();
vi.mock('@/lib/services/campaignReportEmailClient', () => ({
  requestCampaignReportEmail: (...a: unknown[]) => requestEmail(...a),
}));

import Page from '../page';

afterEach(() => { cleanup(); requestEmail.mockReset(); });

describe('Campaign report entry page', () => {
  it('pre-fills location, leader and date and omits the follow-up field', async () => {
    render(<Page />);
    expect(await screen.findByLabelText('Location')).toHaveValue('Orange 1 VIC');
    expect(screen.getByLabelText('Campaign Leader')).toHaveValue('Jane Smith');
    expect(screen.getByLabelText('Campaign Date')).toHaveValue('31/10/2026');
    expect(screen.queryByText(/Follow-up/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('limits counts to two digits and shows one name box per counted person', async () => {
    render(<Page />);
    const partial = await screen.findByLabelText('Number of Partial Presentations *');
    fireEvent.change(partial, { target: { value: 'x123' } });
    expect(partial).toHaveValue('12');
    await waitFor(() => expect(screen.getAllByPlaceholderText(/^Name \d+$/)).toHaveLength(12));
    fireEvent.change(partial, { target: { value: '3' } });
    expect(screen.getAllByPlaceholderText(/^Name \d+$/)).toHaveLength(3);
  });

  it('strips digits and symbols from names (keeps spaces) and caps at 20', async () => {
    render(<Page />);
    fireEvent.change(await screen.findByLabelText('Number of Full Presentations *'), { target: { value: '1' } });
    const name = screen.getByPlaceholderText('Name 1');
    fireEvent.change(name, { target: { value: 'Jo-hn Smith9!' + 'x'.repeat(30) } });
    expect((name as HTMLInputElement).value).toMatch(/^[A-Za-z ]{20}$/);
  });

  it('marks the pre-filled fields read-only with a shaded background and no star', async () => {
    render(<Page />);
    const location = await screen.findByLabelText('Location');
    expect(location).toHaveAttribute('readonly');
    expect(location.className).toContain('bg-gray-200');
    expect(screen.queryByText('Location *')).not.toBeInTheDocument();
  });

  it('requires a number in every count field when Save is clicked', async () => {
    render(<Page />);
    await screen.findByLabelText('Location');
    fireEvent.change(screen.getByLabelText('Number of Full Presentations *'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.getByLabelText('Number of Partial Presentations *')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Number of Full Presentations *')).toHaveAttribute('aria-invalid', 'false');

    fireEvent.change(screen.getByLabelText('Number of Partial Presentations *'), { target: { value: '0' } });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Number of Sinners Prayers *'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('requires a name in every revealed name box when Save is clicked', async () => {
    render(<Page />);
    await screen.findByLabelText('Location');
    fireEvent.change(screen.getByLabelText('Number of Partial Presentations *'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Number of Full Presentations *'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Number of Sinners Prayers *'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Number of Partial Presentations *'), { target: { value: '2' } });
    fireEvent.change(screen.getByPlaceholderText('Name 1'), { target: { value: 'Ann' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Please enter a name in every box.');
    expect(screen.getByPlaceholderText('Name 1')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByPlaceholderText('Name 2')).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(screen.getByPlaceholderText('Name 2'), { target: { value: 'Bob' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  async function fillValidReport() {
    render(<Page />);
    await screen.findByLabelText('Location');
    fireEvent.change(screen.getByLabelText('Number of Partial Presentations *'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Number of Full Presentations *'), { target: { value: '1' } });
    fireEvent.change(screen.getByPlaceholderText('Name 1'), { target: { value: 'Ann' } });
    fireEvent.change(screen.getByLabelText('Number of Sinners Prayers *'), { target: { value: '0' } });
  }

  it('does not email anything while the form is invalid', async () => {
    render(<Page />);
    await screen.findByLabelText('Location');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(requestEmail).not.toHaveBeenCalled();
  });

  it('emails the counts (never the names) when Save is clicked on a valid form', async () => {
    requestEmail.mockResolvedValue('sent');
    await fillValidReport();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Report saved and emailed to management.')).toBeInTheDocument();
    expect(requestEmail).toHaveBeenCalledWith('c1', { partial: 0, full: 1, sinnersPrayers: 0 });
  });

  it('says so when emailing is switched off', async () => {
    requestEmail.mockResolvedValue('disabled');
    await fillValidReport();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Emailing is switched off/)).toBeInTheDocument();
  });

  it('shows an error and allows another try when the email fails', async () => {
    requestEmail.mockRejectedValueOnce(new Error('The report could not be emailed.')).mockResolvedValueOnce('sent');
    await fillValidReport();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The report could not be emailed. Please try again.');
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Report saved and emailed to management.')).toBeInTheDocument();
  });
});
