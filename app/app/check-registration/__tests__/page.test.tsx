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
const mockRequestRegistrationCheck = vi.fn();
vi.mock('@/lib/services/registrationCheckClient', () => ({
  requestRegistrationCheck: (...args: unknown[]) => mockRequestRegistrationCheck(...args),
}));

import CheckRegistrationPage from '../page';

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillAll() {
  fill('First Name', 'Alice');
  fill('Last Name', 'Nguyen');
  fill('Email', 'alice@example.com');
  fill('Mobile', '0412 345 678');
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Check Registration' }));

beforeEach(() => {
  vi.clearAllMocks();
  mockUseUser.mockReturnValue({ user: { id: 'user-1' }, isLoading: false });
});

afterEach(cleanup);

describe('CheckRegistrationPage', () => {
  it('redirects to /login when there is no signed-in user', async () => {
    mockUseUser.mockReturnValue({ user: null, isLoading: false });
    render(<CheckRegistrationPage />);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/login'));
  });

  it('sends the cleaned details and shows "Registered"', async () => {
    mockRequestRegistrationCheck.mockResolvedValue({ status: 'registered', matchedOn: ['email', 'mobile'] });
    render(<CheckRegistrationPage />);
    fillAll();
    submit();

    expect(await screen.findByText('✅ Registered')).toBeTruthy();
    expect(mockRequestRegistrationCheck).toHaveBeenCalledWith({
      firstName: 'Alice', lastName: 'Nguyen', email: 'alice@example.com', mobile: '0412 345 678',
    });
    expect(screen.getByText(/under the email address and mobile number you entered/)).toBeTruthy();
  });

  it('shows "Not Registered"', async () => {
    mockRequestRegistrationCheck.mockResolvedValue({ status: 'not_registered', matchedOn: [] });
    render(<CheckRegistrationPage />);
    fillAll();
    submit();
    expect(await screen.findByText('❌ Not Registered')).toBeTruthy();
  });

  it('shows the different-name result, and flags the contact detail that did not match', async () => {
    mockRequestRegistrationCheck.mockResolvedValue({ status: 'name_mismatch', matchedOn: ['email'] });
    render(<CheckRegistrationPage />);
    fillAll();
    submit();

    expect(await screen.findByText('⚠️ Registered under a different name')).toBeTruthy();
    expect(screen.getByText(/the mobile number you entered is not the one on their registration/)).toBeTruthy();
  });

  it('does not call the API when neither an email nor a mobile is entered', () => {
    render(<CheckRegistrationPage />);
    fill('First Name', 'Alice');
    fill('Last Name', 'Nguyen');
    submit();

    expect(screen.getByRole('alert').textContent).toMatch(/email address or a mobile number/);
    expect(mockRequestRegistrationCheck).not.toHaveBeenCalled();
  });

  it('clears the previous answer as soon as any field is edited', async () => {
    mockRequestRegistrationCheck.mockResolvedValue({ status: 'registered', matchedOn: ['email'] });
    render(<CheckRegistrationPage />);
    fillAll();
    submit();
    await screen.findByText('✅ Registered');

    fill('Email', 'someone.else@example.com');
    expect(screen.queryByText('✅ Registered')).toBeNull();
  });

  it('shows an error — never a "Not Registered" answer — when the check fails', async () => {
    mockRequestRegistrationCheck.mockRejectedValue(new Error('Too many checks.'));
    render(<CheckRegistrationPage />);
    fillAll();
    submit();

    expect((await screen.findByRole('alert')).textContent).toBe('Too many checks.');
    expect(screen.queryByText('❌ Not Registered')).toBeNull();
  });
});
