/**
 * Setting up on a phone means leaving the page to add the key to the
 * authenticator app, and iPhone reloads the page on return. The flow used to
 * create a brand-new setup key on every load, so the key already in the
 * person's app stopped matching and every code failed (an iPhone leader
 * entered seven, 2026-10-13). It now shows the SAME key again after a reload.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('react-qr-code', () => ({ default: ({ value }: { value: string }) => <div data-testid="qrcode" data-value={value} /> }));

const mockListFactors = vi.fn();
const mockUnenroll = vi.fn();
const mockEnroll = vi.fn();
const mockChallengeAndVerify = vi.fn();
const mockSignOut = vi.fn();

vi.mock('@/lib/emailConfirmSupabaseClient', () => ({
  emailConfirmSupabase: {
    auth: {
      signOut: (...a: unknown[]) => mockSignOut(...a),
      mfa: {
        getAuthenticatorAssuranceLevel: () => Promise.resolve({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }),
        listFactors: (...a: unknown[]) => mockListFactors(...a),
        unenroll: (...a: unknown[]) => mockUnenroll(...a),
        enroll: (...a: unknown[]) => mockEnroll(...a),
        challengeAndVerify: (...a: unknown[]) => mockChallengeAndVerify(...a),
      },
    },
  },
}));

import { MfaEnrollmentFlow } from '../MfaEnrollmentFlow';
import { savePendingTotpEnrollment, readPendingTotpEnrollment } from '@/lib/pendingTotpEnrollment';

const FIRST = { id: 'factor-1', totp: { uri: 'otpauth://totp/AFJ:a@x.com?secret=FIRSTKEY', secret: 'FIRSTKEY' } };
const SECOND = { id: 'factor-2', totp: { uri: 'otpauth://totp/AFJ:a@x.com?secret=SECONDKEY', secret: 'SECONDKEY' } };

beforeEach(() => {
  localStorage.clear();
  mockListFactors.mockReset().mockResolvedValue({ data: { all: [] }, error: null });
  mockUnenroll.mockReset().mockResolvedValue({ data: {}, error: null });
  mockEnroll.mockReset().mockResolvedValueOnce({ data: FIRST, error: null }).mockResolvedValue({ data: SECOND, error: null });
  mockChallengeAndVerify.mockReset().mockResolvedValue({ error: null });
  mockSignOut.mockReset().mockResolvedValue({ error: null });
  global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
});
afterEach(() => cleanup());

describe('MfaEnrollmentFlow — setup key survives a reload', () => {
  it('shows the SAME key after the page is reloaded (remount), without enrolling again', async () => {
    const { unmount } = render(<MfaEnrollmentFlow accessToken="tok" onDone={vi.fn()} />);
    expect((await screen.findByTestId('qrcode')).getAttribute('data-value')).toContain('FIRSTKEY');
    expect(mockEnroll).toHaveBeenCalledTimes(1);
    unmount();

    // the reload: the first factor still exists in Supabase as an unverified authenticator
    mockListFactors.mockResolvedValue({ data: { all: [{ id: 'factor-1', factor_type: 'totp', status: 'unverified' }] }, error: null });
    render(<MfaEnrollmentFlow accessToken="tok" onDone={vi.fn()} />);

    expect((await screen.findByTestId('qrcode')).getAttribute('data-value')).toContain('FIRSTKEY');
    expect(screen.getByText('FIRSTKEY')).toBeInTheDocument();
    expect(mockEnroll).toHaveBeenCalledTimes(1);
    expect(mockUnenroll).not.toHaveBeenCalled();
  });

  it('verifies the typed code against the reused factor', async () => {
    savePendingTotpEnrollment({ factorId: 'factor-1', uri: FIRST.totp.uri, secret: 'FIRSTKEY' });
    mockListFactors.mockResolvedValue({ data: { all: [{ id: 'factor-1', factor_type: 'totp', status: 'unverified' }] }, error: null });
    render(<MfaEnrollmentFlow accessToken="tok" onDone={vi.fn()} />);
    await screen.findByTestId('qrcode');

    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }));

    await waitFor(() => expect(mockChallengeAndVerify).toHaveBeenCalledWith({ factorId: 'factor-1', code: '123456' }));
    expect(mockEnroll).not.toHaveBeenCalled();
  });

  it('starts fresh when the remembered factor no longer exists (e.g. Supabase cleaned it up)', async () => {
    savePendingTotpEnrollment({ factorId: 'gone', uri: 'otpauth://x?secret=OLD', secret: 'OLD' });
    mockListFactors.mockResolvedValue({ data: { all: [] }, error: null });
    render(<MfaEnrollmentFlow accessToken="tok" onDone={vi.fn()} />);

    expect((await screen.findByTestId('qrcode')).getAttribute('data-value')).toContain('FIRSTKEY');
    expect(mockEnroll).toHaveBeenCalledTimes(1);
  });

  it('will not reuse a remembered setup that has expired', async () => {
    savePendingTotpEnrollment({ factorId: 'factor-1', uri: 'otpauth://x?secret=OLD', secret: 'OLD' }, Date.now() - 16 * 60 * 1000);
    mockListFactors.mockResolvedValue({ data: { all: [{ id: 'factor-1', factor_type: 'totp', status: 'unverified' }] }, error: null });
    render(<MfaEnrollmentFlow accessToken="tok" onDone={vi.fn()} />);

    expect((await screen.findByTestId('qrcode')).getAttribute('data-value')).toContain('FIRSTKEY');
    expect(mockEnroll).toHaveBeenCalledTimes(1);
  });

  it('forgets the remembered key once setup finishes', async () => {
    const onDone = vi.fn();
    render(<MfaEnrollmentFlow accessToken="tok" onDone={onDone} />);
    await screen.findByTestId('qrcode');
    expect(readPendingTotpEnrollment()).not.toBeNull();

    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and continue/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('success'));
    expect(readPendingTotpEnrollment()).toBeNull();
  });

  it('forgets the remembered key when the person cancels', async () => {
    const onDone = vi.fn();
    render(<MfaEnrollmentFlow accessToken="tok" onDone={onDone} />);
    await screen.findByTestId('qrcode');

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('cancelled'));
    expect(readPendingTotpEnrollment()).toBeNull();
  });
});

describe('MfaEnrollmentFlow — setting up on the phone you are using', () => {
  it('offers an "Add to my authenticator app" link that opens the setup directly in the app', async () => {
    render(<MfaEnrollmentFlow accessToken="tok" onDone={vi.fn()} />);
    const link = await screen.findByRole('link', { name: /add to my authenticator app/i });
    expect(link).toHaveAttribute('href', FIRST.totp.uri);
  });

  it('has a Copy key button that copies the exact key (no stray characters from selecting text)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<MfaEnrollmentFlow accessToken="tok" onDone={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: /copy key/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('FIRSTKEY'));
    expect(await screen.findByRole('button', { name: /key copied/i })).toBeInTheDocument();
  });

  it('tells the person to choose "Time based" when entering the key by hand', async () => {
    render(<MfaEnrollmentFlow accessToken="tok" onDone={vi.fn()} />);
    await screen.findByTestId('qrcode');
    expect(screen.getByText(/time based/i)).toBeInTheDocument();
  });
});

describe('MfaEnrollmentFlow — guidance for people who are not computer-literate', () => {
  it('shows where in the process they are, and how to get help', async () => {
    render(<MfaEnrollmentFlow accessToken="tok" onDone={vi.fn()} />);
    await screen.findByTestId('qrcode');
    expect(screen.getByText(/step 2 of 3: set up your authenticator app/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open the step-by-step guide/i })).toHaveAttribute('href', '/help/2fa');
  });

  it('labels the code box so it cannot be confused with the long number in the email', async () => {
    render(<MfaEnrollmentFlow accessToken="tok" onDone={vi.fn()} />);
    await screen.findByTestId('qrcode');
    expect(screen.getByLabelText(/6-digit code from your authenticator app \(not from the email\)/i)).toBeInTheDocument();
  });

  it('offers app-store links for someone who has no authenticator app yet', async () => {
    render(<MfaEnrollmentFlow accessToken="tok" onDone={vi.fn()} />);
    await screen.findByTestId('qrcode');
    expect(screen.getByText(/i don't have an authenticator app yet/i)).toBeInTheDocument();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.startsWith('https://apps.apple.com/'))).toBe(true);
    expect(hrefs.some((h) => h.startsWith('https://play.google.com/'))).toBe(true);
  });
});
