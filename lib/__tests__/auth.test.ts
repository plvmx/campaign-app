import { describe, it, expect, vi } from 'vitest';

// Prevent supabaseClient from requiring real env vars at import time
vi.mock('../supabaseClient', () => ({
  supabase: { auth: {}, from: vi.fn() },
}));

import { normalizeMobile, normalizeName } from '../auth';

describe('normalizeMobile', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeMobile('')).toBe('');
  });

  it('leaves a clean 10-digit number unchanged', () => {
    expect(normalizeMobile('0412345678')).toBe('0412345678');
  });

  it('strips spaces from formatted numbers', () => {
    expect(normalizeMobile('0412 345 678')).toBe('0412345678');
  });

  it('strips dashes', () => {
    expect(normalizeMobile('0412-345-678')).toBe('0412345678');
  });

  it('strips parentheses', () => {
    expect(normalizeMobile('(0412) 345678')).toBe('0412345678');
  });

  it('handles +61 country code without space', () => {
    expect(normalizeMobile('+61412345678')).toBe('0412345678');
  });

  it('handles +61 country code with space', () => {
    expect(normalizeMobile('+61 412345678')).toBe('0412345678');
  });

  it('handles +61 country code followed by 0 (redundant zero)', () => {
    expect(normalizeMobile('+61 0412345678')).toBe('0412345678');
  });

  it('adds leading 0 to 9-digit number after country code removal', () => {
    // +61 429028464 → 429028464 (9 digits, no leading 0) → 0429028464
    expect(normalizeMobile('+61 429028464')).toBe('0429028464');
  });

  it('does not add leading 0 to numbers with other lengths', () => {
    // 8-digit number should not get a 0 prepended
    expect(normalizeMobile('12345678')).toBe('12345678');
  });
});

describe('normalizeName', () => {
  it('lowercases the name', () => {
    expect(normalizeName('Peter')).toBe('peter');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeName('  Jane  ')).toBe('jane');
  });

  it('lowercases mixed case', () => {
    expect(normalizeName('JOHN SMITH')).toBe('john smith');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeName('')).toBe('');
  });
});
