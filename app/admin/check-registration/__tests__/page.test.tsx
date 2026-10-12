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

const ALICE = {
  id: 'r-alice', firstName: 'Alice', lastName: 'Nguyen', email: 'alice@example.com', phone: '+61412345678',
  state: 'VIC', postcode: '3000', registeredAt: '2026-09-12T03:00:00Z',
  webinarSessionAt: null, webinarAttended: null, codeOfConductAgreed: 'Yes', codeOfConductAgreedAt: null,
  unsubscribed: null, nfc: null, matchedOn: ['email'],
};

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
    mockLookup.mockResolvedValue({ registered: true, matchedOn: ['email'], registrants: [ALICE] });
    render(<AdminCheckRegistrationPage />);
    fill('Mobile', ' 0412 345 678 ');
    fill('Email', 'alice@example.com');
    submit();

    expect(await screen.findByText('✅ Registered')).toBeTruthy();
    expect(mockLookup).toHaveBeenCalledWith({ email: 'alice@example.com', mobile: '0412 345 678' });
    expect(screen.getByText('There is a registration with the email address alice@example.com.')).toBeTruthy();
    expect(screen.getByText('No registration has the mobile number 0412 345 678.')).toBeTruthy();
  });

  it('shows the registration details of the person found', async () => {
    mockLookup.mockResolvedValue({ registered: true, matchedOn: ['email'], registrants: [ALICE] });
    render(<AdminCheckRegistrationPage />);
    fill('Email', 'alice@example.com');
    submit();

    expect(await screen.findByRole('heading', { name: 'Alice Nguyen' })).toBeTruthy();
    const details = screen.getByRole('status').textContent ?? '';
    for (const expected of ['Matched on email address', '+61412345678', 'VIC', '3000', 'Code agreedYes']) {
      expect(details).toContain(expected);
    }
    // Month abbreviation ("Sep"/"Sept") varies with the runtime's locale data.
    expect(details).toMatch(/Registered12 Sept? 2026/);
    expect(details).not.toMatch(/Unsubscribed|No Further Contact/);
  });

  it('flags an unsubscribed / No Further Contact registrant', async () => {
    mockLookup.mockResolvedValue({
      registered: true, matchedOn: ['email'], registrants: [{ ...ALICE, unsubscribed: 'Yes', nfc: 'Yes' }],
    });
    render(<AdminCheckRegistrationPage />);
    fill('Email', 'alice@example.com');
    submit();
    expect(await screen.findByText('Unsubscribed · No Further Contact')).toBeTruthy();
  });

  it('lists every matching registration when there is more than one', async () => {
    mockLookup.mockResolvedValue({
      registered: true,
      matchedOn: ['email', 'mobile'],
      registrants: [ALICE, { ...ALICE, id: 'r-bao', firstName: 'Bao', email: 'bao@example.com', matchedOn: ['mobile'] }],
    });
    render(<AdminCheckRegistrationPage />);
    fill('Mobile', '0412 345 678');
    fill('Email', 'alice@example.com');
    submit();

    expect(await screen.findByText(/2 different registrations match/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Alice Nguyen' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Bao Nguyen' })).toBeTruthy();
  });

  it('works with a mobile on its own, and shows "Not Registered"', async () => {
    mockLookup.mockResolvedValue({ registered: false, matchedOn: [], registrants: [] });
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
    mockLookup.mockResolvedValue({ registered: true, matchedOn: ['email'], registrants: [ALICE] });
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
