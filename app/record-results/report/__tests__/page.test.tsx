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
    expect(await screen.findByLabelText('Location *')).toHaveValue('Orange 1 VIC');
    expect(screen.getByLabelText('Campaign Leader *')).toHaveValue('Jane Smith');
    expect(screen.getByLabelText('Campaign Date *')).toHaveValue('31/10/2026');
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
});
