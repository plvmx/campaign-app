import { describe, expect, it } from 'vitest';
import { normalizePhone } from '../phone';

describe('normalizePhone', () => {
  it('passes through an already-E.164 number', () => {
    expect(normalizePhone('+61438438438')).toBe('+61438438438');
  });

  it('converts a leading-0 domestic number to E.164', () => {
    expect(normalizePhone('0438438438')).toBe('+61438438438');
  });

  it('strips spaces from a spaced domestic number', () => {
    expect(normalizePhone('0438 438 438')).toBe('+61438438438');
  });

  it('strips spaces and a leading + from a spaced international number', () => {
    expect(normalizePhone('+61 438 438 438')).toBe('+61438438438');
  });

  it('assumes a missing country code and prepends +61 as a fallback', () => {
    expect(normalizePhone('438438438')).toBe('+61438438438');
  });

  it('returns null for null input', () => {
    expect(normalizePhone(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(normalizePhone(undefined)).toBeNull();
  });

  it('returns null for an empty/whitespace-only string rather than guessing', () => {
    expect(normalizePhone('   ')).toBeNull();
  });
});
