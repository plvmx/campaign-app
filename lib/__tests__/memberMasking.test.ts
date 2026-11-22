import { describe, it, expect } from 'vitest';
import { maskEmail, maskMobile } from '../memberMasking';

describe('maskEmail', () => {
  it('keeps the first letter and the domain only', () => {
    expect(maskEmail('jane.smith@gmail.com')).toBe('j•••@gmail.com');
    expect(maskEmail('  A@b.org ')).toBe('A•••@b.org');
  });
  it('reveals nothing when there is no usable local part', () => {
    expect(maskEmail('')).toBe('•••');
    expect(maskEmail('@gmail.com')).toBe('•••');
  });
});

describe('maskMobile', () => {
  it('shows the first two and last three digits, from any format', () => {
    for (const m of ['0412 345 678', '+61412345678', '61412345678', '0412345678']) expect(maskMobile(m)).toBe('04•• ••• 678');
  });
  it('reveals nothing for a too-short number', () => {
    expect(maskMobile('123')).toBe('•••');
  });
});
