import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: {}, from: vi.fn() } }));

import { getAdminLoginGate } from '../adminLoginGate';

describe('getAdminLoginGate', () => {
  it('sends an enrolled AD to email sign-in', () => {
    expect(getAdminLoginGate({ admin: 'AD', mfaEnrolledAt: '2026-10-01T00:00:00Z' })).toBe('sign-in-with-email');
  });

  it('sends an enrolled SR to email sign-in', () => {
    expect(getAdminLoginGate({ admin: 'SR', mfaEnrolledAt: '2026-10-01T00:00:00Z' })).toBe('sign-in-with-email');
  });

  it('makes an unenrolled AD or SR set up 2FA first', () => {
    expect(getAdminLoginGate({ admin: 'AD', mfaEnrolledAt: null })).toBe('set-up-2fa');
    expect(getAdminLoginGate({ admin: 'SR', mfaEnrolledAt: null })).toBe('set-up-2fa');
  });

  it('does not gate a plain leader, enrolled or not', () => {
    expect(getAdminLoginGate({ admin: null, mfaEnrolledAt: null })).toBeNull();
    expect(getAdminLoginGate({ admin: null, mfaEnrolledAt: '2026-10-01T00:00:00Z' })).toBeNull();
  });

  it('does not treat junk in the admin column as an admin (same rule as isRecognizedAdminStatus)', () => {
    expect(getAdminLoginGate({ admin: 'N', mfaEnrolledAt: null })).toBeNull();
    expect(getAdminLoginGate({ admin: '', mfaEnrolledAt: null })).toBeNull();
  });

  describe('requireTwoFactor (a plain leader who needs 2FA to see member details)', () => {
    it('makes an unenrolled plain leader set up 2FA', () => {
      expect(getAdminLoginGate({ admin: null, mfaEnrolledAt: null }, { requireTwoFactor: true })).toBe('set-up-2fa');
    });

    it('sends an enrolled plain leader to email sign-in', () => {
      expect(getAdminLoginGate({ admin: null, mfaEnrolledAt: '2026-10-01T00:00:00Z' }, { requireTwoFactor: true })).toBe('sign-in-with-email');
    });

    it('is off by default and when explicitly false', () => {
      expect(getAdminLoginGate({ admin: null, mfaEnrolledAt: null }, {})).toBeNull();
      expect(getAdminLoginGate({ admin: null, mfaEnrolledAt: null }, { requireTwoFactor: false })).toBeNull();
    });
  });
});
