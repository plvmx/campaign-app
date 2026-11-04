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

import Page from '../page';

afterEach(cleanup);

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

    fireEvent.change(screen.getByLabelText('Number of Partial Presentations *'), { target: { value: '2' } });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Number of Sinners Prayers *'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
