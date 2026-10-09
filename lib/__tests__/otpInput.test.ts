import { describe, it, expect } from 'vitest';
import { normalizeOtpInput, EMAIL_OTP_MAX_LENGTH } from '@/lib/otpInput';

describe('normalizeOtpInput', () => {
  it('passes a clean 6-digit code through', () => {
    expect(normalizeOtpInput('123456')).toBe('123456');
  });

  it('strips leading/trailing whitespace and newlines from a pasted code', () => {
    expect(normalizeOtpInput(' 123456\n')).toBe('123456');
    expect(normalizeOtpInput(' 123456 ')).toBe('123456');
  });

  it('strips a pasted label and internal spaces', () => {
    expect(normalizeOtpInput('Code: 123 456')).toBe('123456');
  });

  it('caps at 6 digits', () => {
    expect(normalizeOtpInput('12345678')).toBe('123456');
  });

  it('returns empty for no digits', () => {
    expect(normalizeOtpInput('abc')).toBe('');
  });

  it('keeps a full 8-digit emailed code when given the email max length', () => {
    expect(normalizeOtpInput('16510716', EMAIL_OTP_MAX_LENGTH)).toBe('16510716');
    expect(normalizeOtpInput(' 1651 0716\n', EMAIL_OTP_MAX_LENGTH)).toBe('16510716');
  });

  it('still caps an emailed code at the email max length', () => {
    expect(normalizeOtpInput('123456789012', EMAIL_OTP_MAX_LENGTH)).toBe('1234567890');
  });
});
