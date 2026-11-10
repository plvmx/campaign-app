/**
 * Two regressions confirmed live, both fixed here:
 *
 * 1. Supabase's own totp.qr_code SVG is absurdly bloated (362,632
 *    characters for a 231x231px code, a known upstream inefficiency) —
 *    rendering it as an <img data:...> source produced a blank image
 *    regardless of encoding. Fixed by rendering our own compact QR code
 *    client-side (react-qr-code) from totp.uri instead.
 * 2. A second enroll() call (e.g. from a page reload, or any retry after
 *    the first attempt didn't complete) gets rejected with a 422 "factor
 *    name conflict", since both attempts default to the same empty
 *    friendly_name — permanently stranding anyone who ever retries. Fixed
 *    by unenrolling any stale unverified TOTP factor before enrolling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

vi.mock('react-qr-code', () => ({
  default: ({ value }: { value: string }) => <div data-testid="qrcode" data-value={value} />,
}));

const mockListFactors = vi.fn();
const mockUnenroll = vi.fn();
const mockEnroll = vi.fn();
vi.mock('@/lib/registrySupabaseClient', () => ({
  registrySupabase: {
    auth: {
      mfa: {
        listFactors: (...args: unknown[]) => mockListFactors(...args),
        unenroll: (...args: unknown[]) => mockUnenroll(...args),
        enroll: (...args: unknown[]) => mockEnroll(...args),
        challengeAndVerify: vi.fn(),
      },
    },
  },
}));

vi.mock('@/lib/registryAuth', () => ({
  setRegistrySessionCookie: vi.fn(),
}));

vi.mock('@/app/registry/useRegistryGate', () => ({
  useRegistryGate: () => ({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

import RegistryMfaEnrollPage from '../page';

const FRESH_ENROLL_RESPONSE = {
  data: { id: 'factor-1', totp: { uri: 'otpauth://totp/AFJ:test@example.com?secret=SECRETKEY&issuer=AFJ', secret: 'SECRETKEY' } },
  error: null,
};

describe('RegistryMfaEnrollPage', () => {
  beforeEach(() => {
    mockListFactors.mockReset().mockResolvedValue({ data: { all: [] }, error: null });
    mockUnenroll.mockReset().mockResolvedValue({ data: {}, error: null });
    mockEnroll.mockReset().mockResolvedValue(FRESH_ENROLL_RESPONSE);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a compact client-side QR code from totp.uri, not the bloated Supabase SVG', async () => {
    render(<RegistryMfaEnrollPage />);

    const qr = await screen.findByTestId('qrcode');
    expect(qr.getAttribute('data-value')).toBe(FRESH_ENROLL_RESPONSE.data.totp.uri);
  });

  it('still shows the manual-entry secret', async () => {
    render(<RegistryMfaEnrollPage />);
    expect(await screen.findByText('SECRETKEY')).toBeInTheDocument();
  });

  it('unenrolls a stale unverified TOTP factor before enrolling a fresh one', async () => {
    mockListFactors.mockResolvedValue({
      data: {
        all: [
          { id: 'stale-1', factor_type: 'totp', status: 'unverified' },
          { id: 'verified-1', factor_type: 'totp', status: 'verified' }, // must NOT be touched
          { id: 'phone-1', factor_type: 'phone', status: 'unverified' }, // different type, must NOT be touched
        ],
      },
      error: null,
    });

    render(<RegistryMfaEnrollPage />);

    await waitFor(() => expect(mockUnenroll).toHaveBeenCalledTimes(1));
    expect(mockUnenroll).toHaveBeenCalledWith({ factorId: 'stale-1' });
    await waitFor(() => expect(mockEnroll).toHaveBeenCalled());
  });

  it('does not call unenroll when there is nothing stale to clean up', async () => {
    render(<RegistryMfaEnrollPage />);
    await waitFor(() => expect(mockEnroll).toHaveBeenCalled());
    expect(mockUnenroll).not.toHaveBeenCalled();
  });
});
