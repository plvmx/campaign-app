import { describe, it, expect } from 'vitest';
import { isValidEmail } from '../emailFormat';

describe('isValidEmail', () => {
  it('accepts a plausible address, ignoring surrounding spaces', () => {
    expect(isValidEmail(' a@example.com ')).toBe(true);
  });
  it.each(['', 'a', 'a@b', '@example.com', 'a b@example.com'])('rejects %j', (v) => {
    expect(isValidEmail(v)).toBe(false);
  });
});
