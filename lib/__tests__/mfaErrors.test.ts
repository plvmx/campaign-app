import { describe, it, expect } from 'vitest';
import { describeMfaVerifyError } from '../mfaErrors';

describe('describeMfaVerifyError', () => {
  it('explains a wrong code in terms of what to check, not Supabase jargon', () => {
    const text = describeMfaVerifyError({ message: 'Invalid TOTP code entered', code: 'mfa_verification_failed' });
    expect(text).toMatch(/newest "AFJ Campaign App" entry/);
    expect(text).toMatch(/delete any older AFJ entries/i);
    expect(text).toMatch(/date and time/i);
    expect(text).not.toMatch(/TOTP/);
  });

  it('recognises a wrong code by message alone when no code is present', () => {
    expect(describeMfaVerifyError({ message: 'Invalid TOTP code entered' })).toMatch(/didn't work/);
  });

  it('handles an expired challenge, rate limiting and a missing factor', () => {
    expect(describeMfaVerifyError({ message: 'MFA challenge has expired', code: 'mfa_challenge_expired' })).toMatch(/too long/i);
    expect(describeMfaVerifyError({ message: 'x', code: 'over_request_rate_limit' })).toMatch(/wait a minute/i);
    expect(describeMfaVerifyError({ message: 'Factor not found' })).toMatch(/start setup again/i);
  });

  it('passes through any other error message unchanged', () => {
    expect(describeMfaVerifyError({ message: 'Something unexpected', code: 'unexpected_failure' })).toBe('Something unexpected');
  });
});
