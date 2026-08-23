import { describe, it, expect, vi } from 'vitest';

// isValidMobile pulls in normalizeMobile from ../auth -> ../supabaseClient,
// which requires real env vars at import time. Stub it out (unused here).
vi.mock('../supabaseClient', () => ({
  supabase: { auth: {}, from: vi.fn() },
}));

import { isValidMobile, isValidEmail } from '../validation';

describe('isValidMobile', () => {
  it('accepts a plain 10-digit Australian mobile number', () => {
    expect(isValidMobile('0412345678')).toBe(true);
  });

  it('accepts formatting the same way normalizeMobile does — spaces, dashes, +61', () => {
    expect(isValidMobile('0412 345 678')).toBe(true);
    expect(isValidMobile('0412-345-678')).toBe(true);
    expect(isValidMobile('+61412345678')).toBe(true);
    expect(isValidMobile('+61 412 345 678')).toBe(true);
  });

  it('rejects a landline-shaped number (not a 04 mobile prefix)', () => {
    expect(isValidMobile('0212345678')).toBe(false);
  });

  it('rejects too few or too many digits', () => {
    expect(isValidMobile('041234567')).toBe(false); // 9 digits
    expect(isValidMobile('04123456789')).toBe(false); // 11 digits
  });

  it('rejects empty or non-numeric input', () => {
    expect(isValidMobile('')).toBe(false);
    expect(isValidMobile('not a number')).toBe(false);
  });
});

describe('isValidEmail', () => {
  it('accepts a plausible email address', () => {
    expect(isValidEmail('sam@example.com')).toBe(true);
    expect(isValidEmail('sam.jones+campaign@sub.example.co.uk')).toBe(true);
  });

  it('tolerates surrounding whitespace', () => {
    expect(isValidEmail('  sam@example.com  ')).toBe(true);
  });

  it('rejects input missing an @ or a domain dot', () => {
    expect(isValidEmail('sam')).toBe(false);
    expect(isValidEmail('sam@')).toBe(false);
    expect(isValidEmail('@example.com')).toBe(false);
    expect(isValidEmail('sam@example')).toBe(false);
  });

  it('rejects empty input', () => {
    expect(isValidEmail('')).toBe(false);
  });
});
