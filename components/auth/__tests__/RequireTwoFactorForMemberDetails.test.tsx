import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

const mockGetAal = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { mfa: { getAuthenticatorAssuranceLevel: (...a: unknown[]) => mockGetAal(...a) } } },
}));
const mockStart = vi.fn();
vi.mock('@/lib/twoFactorSetup', () => ({ startTwoFactorSignIn: (...a: unknown[]) => mockStart(...a) }));
vi.mock('@/components/MobileLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import RequireTwoFactorForMemberDetails from '../RequireTwoFactorForMemberDetails';

const Secret = () => <p>member details list</p>;

beforeEach(() => { mockGetAal.mockReset(); mockStart.mockReset(); });
afterEach(cleanup);

describe('RequireTwoFactorForMemberDetails', () => {
  it('shows the protected content once the session has passed 2FA', async () => {
    mockGetAal.mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' } });
    render(<RequireTwoFactorForMemberDetails><Secret /></RequireTwoFactorForMemberDetails>);
    expect(await screen.findByText('member details list')).toBeInTheDocument();
  });

  it('does NOT mount the content (so it never fetches the rows) for a session that has not passed 2FA', async () => {
    mockGetAal.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1' } });
    render(<RequireTwoFactorForMemberDetails><Secret /></RequireTwoFactorForMemberDetails>);
    expect(await screen.findByText('Extra security needed')).toBeInTheDocument();
    expect(screen.queryByText('member details list')).not.toBeInTheDocument();
  });

  it('fails closed if the 2FA level cannot be read', async () => {
    mockGetAal.mockRejectedValue(new Error('network'));
    render(<RequireTwoFactorForMemberDetails><Secret /></RequireTwoFactorForMemberDetails>);
    expect(await screen.findByText('Extra security needed')).toBeInTheDocument();
    expect(screen.queryByText('member details list')).not.toBeInTheDocument();
  });

  it('starts the 2FA sign-in when the leader taps the button', async () => {
    mockGetAal.mockResolvedValue({ data: { currentLevel: 'aal1' } });
    mockStart.mockResolvedValue(undefined);
    render(<RequireTwoFactorForMemberDetails><Secret /></RequireTwoFactorForMemberDetails>);
    fireEvent.click(await screen.findByRole('button', { name: /set up two-factor authentication/i }));
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
  });

  it('shows an error and lets them retry if sign-out fails', async () => {
    mockGetAal.mockResolvedValue({ data: { currentLevel: 'aal1' } });
    mockStart.mockRejectedValue(new Error('sign out failed'));
    render(<RequireTwoFactorForMemberDetails><Secret /></RequireTwoFactorForMemberDetails>);
    fireEvent.click(await screen.findByRole('button', { name: /set up two-factor authentication/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/sign out failed/);
    expect(screen.getByRole('button', { name: /set up two-factor authentication/i })).not.toBeDisabled();
  });
});
