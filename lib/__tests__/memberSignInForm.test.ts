import { describe, it, expect } from 'vitest';
import {
  hasFormErrors, normalizeEmailInput, normalizeMemberCodeInput, normalizeMobileInput,
  validateCodeField, validateCodes, validateDetailsField, validateDetails, MEMBER_MOBILE_MAX_LENGTH,
} from '../memberSignInForm';

describe('input restriction as typed', () => {
  it('email: strips whitespace and caps at 254', () => {
    expect(normalizeEmailInput(' jane @ gmail.com ')).toBe('jane@gmail.com');
    expect(normalizeEmailInput('a'.repeat(300))).toHaveLength(254);
  });
  it('mobile: keeps digits, spaces and one leading +, caps the length', () => {
    expect(normalizeMobileInput('0412 abc 345-678')).toBe('0412  345678');
    expect(normalizeMobileInput('+61 412+345')).toBe('+61 412345');
    expect(normalizeMobileInput('61+412')).toBe('61412');
    expect(normalizeMobileInput('1'.repeat(40))).toHaveLength(MEMBER_MOBILE_MAX_LENGTH);
  });
  it('code: digits only, at most 6, cleaning a pasted "Code: 123 456" rather than truncating it first', () => {
    expect(normalizeMemberCodeInput('12ab34')).toBe('1234');
    expect(normalizeMemberCodeInput('Code: 123 456 789')).toBe('123456');
  });
});

describe('validateDetails', () => {
  it('passes a valid email and Australian mobile in any common format', () => {
    for (const mobile of ['0412345678', '0412 345 678', '+61412345678']) {
      expect(validateDetails({ email: 'jane@gmail.com', mobile })).toEqual({});
    }
  });
  it('requires both, with a message for each', () => {
    expect(validateDetails({ email: '', mobile: '  ' })).toEqual({
      email: 'Please enter your email address.',
      mobile: 'Please enter your mobile number.',
    });
  });
  it('rejects a malformed email and a non-mobile number', () => {
    expect(validateDetailsField('email', 'jane@')).toMatch(/check your email/);
    expect(validateDetailsField('mobile', '0212345678')).toMatch(/check your mobile/);
    expect(validateDetailsField('mobile', '0412')).toMatch(/check your mobile/);
  });
});

describe('validateCodes', () => {
  it('passes two 6-digit codes, including leading zeros', () => {
    expect(validateCodes({ emailCode: '000123', smsCode: '654321' })).toEqual({});
  });
  it('requires each code and names the right box', () => {
    expect(validateCodes({ emailCode: '', smsCode: '' })).toEqual({
      emailCode: 'Please type the code from the email.',
      smsCode: 'Please type the code from the text message.',
    });
    expect(validateCodeField('emailCode', '12345')).toMatch(/email has 6 digits/);
    expect(validateCodeField('smsCode', '12345')).toMatch(/text message has 6 digits/);
  });
});

describe('hasFormErrors', () => {
  it('ignores cleared (undefined) messages', () => {
    expect(hasFormErrors({})).toBe(false);
    expect(hasFormErrors({ email: undefined })).toBe(false);
    expect(hasFormErrors({ email: 'x' })).toBe(true);
  });
});
