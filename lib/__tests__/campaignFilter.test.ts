import { describe, it, expect, vi } from 'vitest';

// Prevent supabaseClient from requiring real env vars at import time
vi.mock('../supabaseClient', () => ({
  supabase: { auth: {}, from: vi.fn() },
}));

import { isRecognizedAdminStatus } from '../campaignFilter';

// Regression coverage for #78: login's post-sign-in chooser used
// `if (!match.admin)`, a truthy check, so any non-empty junk value in the
// `admin` column (e.g. a recruiter's name) was treated as "is admin" and
// routed the leader into the wrong post-login flow. isRecognizedAdminStatus
// must only ever recognize the exact 'AD' / 'SR' status codes.
describe('isRecognizedAdminStatus', () => {
  it('recognizes full admin', () => {
    expect(isRecognizedAdminStatus('AD')).toBe(true);
  });

  it('recognizes state reporter', () => {
    expect(isRecognizedAdminStatus('SR')).toBe(true);
  });

  it('rejects null', () => {
    expect(isRecognizedAdminStatus(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isRecognizedAdminStatus(undefined)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isRecognizedAdminStatus('')).toBe(false);
  });

  it('rejects stray legacy data such as a recruiter\'s name (the #78 case)', () => {
    expect(isRecognizedAdminStatus('Lorraine')).toBe(false);
  });

  it('rejects lowercase variants — comparison is exact, not case-insensitive', () => {
    expect(isRecognizedAdminStatus('ad')).toBe(false);
    expect(isRecognizedAdminStatus('sr')).toBe(false);
  });
});
