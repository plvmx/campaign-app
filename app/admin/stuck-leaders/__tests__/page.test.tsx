import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import type { StuckLeader } from '@/lib/services/stuckLeadersService';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/MobileLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/LoadingSpinner', () => ({ default: () => <div>loading</div> }));
const mockUser = vi.fn();
vi.mock('@/contexts/UserContext', () => ({ useUser: () => mockUser() }));
const mockFetch = vi.fn();
vi.mock('@/lib/services/stuckLeadersClient', () => ({ fetchStuckLeaders: (...a: unknown[]) => mockFetch(...a) }));

import StuckLeadersPage from '../page';

const leader = (over: Partial<StuckLeader> = {}): StuckLeader => ({
  key: 'k1', name: 'Jack', role: 'Leader', isAdmin: false, states: ['NSW'], mobile: '0400 111 222',
  email: 'jack@example.com', stage: '2fa-started', label: 'Opened 2FA setup but did not finish',
  action: 'Check the code.', lastActivityAt: new Date(Date.now() - 3 * 3600_000).toISOString(), ...over,
});

beforeEach(() => {
  mockUser.mockReset().mockReturnValue({ user: { id: 'u1' }, isAdmin: true, isLoading: false });
  mockFetch.mockReset();
});
afterEach(() => cleanup());

describe('/admin/stuck-leaders', () => {
  it('lists admins first under their own heading, then other leaders', async () => {
    mockFetch.mockResolvedValue([
      leader({ key: 'a', name: 'Sam_AD', role: 'Admin', isAdmin: true, label: 'Has not started — no email on file' }),
      leader({ key: 'b', name: 'Jack' }),
    ]);
    render(<StuckLeadersPage />);

    expect(await screen.findByText(/admins who can't sign in as admin yet \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/other leaders part-way through \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText('Sam_AD')).toBeInTheDocument();
    expect(screen.getByText('Opened 2FA setup but did not finish')).toBeInTheDocument();
    expect(screen.getAllByText(/3 hours ago/).length).toBeGreaterThan(0);
  });

  it('gives a Call link and a pre-filled Text-a-reminder link when there is a mobile number', async () => {
    mockFetch.mockResolvedValue([leader({ name: 'Sam_AD', role: 'Admin', isAdmin: true })]);
    render(<StuckLeadersPage />);

    expect(await screen.findByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+61400111222');
    const sms = screen.getByRole('link', { name: /text a reminder/i }).getAttribute('href') ?? '';
    expect(sms.startsWith('sms:+61400111222?&body=')).toBe(true);
    const body = decodeURIComponent(sms.split('&body=')[1]);
    expect(body).toContain('Hi Sam,'); // the _AD suffix is dropped from the name
    expect(body).toContain('/help/2fa');
  });

  it('says so when nobody is stuck', async () => {
    mockFetch.mockResolvedValue([]);
    render(<StuckLeadersPage />);
    expect(await screen.findByText(/nobody is stuck right now/i)).toBeInTheDocument();
  });

  it('shows the error rather than an empty "nobody is stuck" when loading fails', async () => {
    mockFetch.mockRejectedValue(new Error('Two-factor sign-in is required for this action'));
    render(<StuckLeadersPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/two-factor sign-in is required/i);
    expect(screen.queryByText(/nobody is stuck right now/i)).not.toBeInTheDocument();
  });

  it('does not even ask for the list when the signed-in user is not an admin', async () => {
    mockUser.mockReturnValue({ user: { id: 'u1' }, isAdmin: false, isLoading: false });
    render(<StuckLeadersPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/do not have permission/i));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
