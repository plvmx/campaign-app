/**
 * Regression test: confirmed live that the QR code rendered blank. Root
 * cause — the enrollment response's raw SVG markup was concatenated
 * directly after "data:image/svg+xml;utf-8," with no encoding. QR-code
 * SVGs contain hex-color fills like fill="#000000", and an un-encoded '#'
 * inside a data: URI is read as the URI's fragment delimiter, silently
 * truncating everything after the first one — the browser never sees a
 * complete/valid SVG. Fixed by encodeURIComponent-ing the SVG markup
 * before embedding it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const SVG_WITH_HEX_COLOR = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#000000" width="10" height="10"/></svg>';

const mockEnroll = vi.fn();
vi.mock('@/lib/registrySupabaseClient', () => ({
  registrySupabase: {
    auth: {
      mfa: {
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

describe('RegistryMfaEnrollPage', () => {
  beforeEach(() => {
    mockEnroll.mockReset().mockResolvedValue({
      data: { id: 'factor-1', totp: { qr_code: SVG_WITH_HEX_COLOR, secret: 'SECRETKEY' } },
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('percent-encodes the SVG markup so a hex-color # does not truncate the data URI', async () => {
    render(<RegistryMfaEnrollPage />);

    const img = await screen.findByAltText(/scan this qr code/i);
    const src = img.getAttribute('src');

    expect(src).toBe(`data:image/svg+xml,${encodeURIComponent(SVG_WITH_HEX_COLOR)}`);
    // The exact regression: a raw, unencoded '#' would truncate the URI here.
    expect(src).toContain('%23');
    expect(src).not.toMatch(/svg\+xml[^,]*,.*#/); // no literal '#' survives past the data: prefix
  });

  it('still shows the manual-entry secret regardless of the QR code', async () => {
    render(<RegistryMfaEnrollPage />);
    expect(await screen.findByText('SECRETKEY')).toBeInTheDocument();
  });
});
