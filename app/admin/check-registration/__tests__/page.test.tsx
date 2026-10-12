import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const mockPush = vi.fn();
const mockRouter = { push: mockPush };
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

vi.mock('@/components/MobileLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockUseUser = vi.fn();
vi.mock('@/contexts/UserContext', () => ({
  useUser: () => mockUseUser(),
}));

// The real module imports lib/supabaseClient.ts, which needs env vars at import time.
const mockLookup = vi.fn();
vi.mock('@/lib/services/registrationCheckClient', () => ({
  requestAdminRegistrationLookup: (...args: unknown[]) => mockLookup(...args),
}));

import AdminCheckRegistrationPage from '../page';

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Check Registry' }));

beforeEach(() => {
  vi.clearAllMocks();
  mockUseUser.mockReturnValue({ user: { id: 'user-1' }, isAdmin: true, isLoading: false });
});

afterEach(cleanup);

describe('AdminCheckRegistrationPage', () => {
  it('redirects to /login when there is no signed-in user', async () => {
    mockUseUser.mockReturnValue({ user: null, isAdmin: false, isLoading: false });
    render(<AdminCheckRegistrationPage />);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/login'));
  });

  it('shows Access Denied, and no form, to a non-admin', () => {
    mockUseUser.mockReturnValue({ user: { id: 'user-1' }, isAdmin: false, isLoading: false });
    render(<AdminCheckRegistrationPage />);
    expect(screen.getByText('Access Denied')).toBeTruthy();
    expect(screen.queryByLabelText('Mobile')).toBeNull();
  });

  it('asks only for mobile and email', () => {
    render(<AdminCheckRegistrationPage />);
    expect(screen.getAllByRole('textbox').map((input) => input.id)).toEqual(['lookup-mobile', 'lookup-email']);
  });

  it('sends the cleaned details and says which one is registered', async () => {
    mockLookup.mockResolvedValue({ registered: true, matchedOn: ['email'] });
    render(<AdminCheckRegistrationPage />);
    fill('Mobile', ' 0412 345 678 ');
    fill('Email', 'alice@example.com');
    submit();

    expect(await screen.findByText('✅ Registered')).toBeTruthy();
    expect(mockLookup).toHaveBeenCalledWith({ email: 'alice@example.com', mobile: '0412 345 678' });
    expect(screen.getByText('There is a registration with the email address alice@example.com.')).toBeTruthy();
    expect(screen.getByText('No registration has the mobile number 0412 345 678.')).toBeTruthy();
  });

  it('works with a mobile on its own, and shows "Not Registered"', async () => {
    mockLookup.mockResolvedValue({ registered: false, matchedOn: [] });
    render(<AdminCheckRegistrationPage />);
    fill('Mobile', '0412 345 678');
    submit();

    expect(await screen.findByText('❌ Not Registered')).toBeTruthy();
    expect(mockLookup).toHaveBeenCalledWith({ email: null, mobile: '0412 345 678' });
    expect(screen.getByText('No registration was found for 0412 345 678.')).toBeTruthy();
  });

  it('does not call the API when both fields are empty', () => {
    render(<AdminCheckRegistrationPage />);
    submit();
    expect(screen.getByRole('alert').textContent).toMatch(/email address or a mobile number/);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('clears the previous answer as soon as a field is edited', async () => {
    mockLookup.mockResolvedValue({ registered: true, matchedOn: ['email'] });
    render(<AdminCheckRegistrationPage />);
    fill('Email', 'alice@example.com');
    submit();
    await screen.findByText('✅ Registered');

    fill('Email', 'someone.else@example.com');
    expect(screen.queryByText('✅ Registered')).toBeNull();
  });

  it("shows the server's refusal (e.g. no 2FA) as an error, never as an answer", async () => {
    mockLookup.mockRejectedValue(new Error('Two-factor sign-in is required for this action'));
    render(<AdminCheckRegistrationPage />);
    fill('Email', 'alice@example.com');
    submit();

    expect((await screen.findByRole('alert')).textContent).toBe('Two-factor sign-in is required for this action');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
