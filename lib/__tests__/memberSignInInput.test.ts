import { describe, it, expect } from 'vitest';
import { isAustralianMobile, isInviteToken, isVerificationId, parseRequestCodesBody, parseVerifyBody } from '../memberSignInInput';

const TOKEN = 'a'.repeat(43);
const VID = '11111111-1111-4111-8111-111111111111';

describe('parseRequestCodesBody', () => {
  it('accepts a well-formed invite token', () => {
    expect(parseRequestCodesBody({ invite: TOKEN })).toEqual({ ok: true, input: { via: 'invite', inviteToken: TOKEN } });
  });
  it('rejects a bad invite token — and never falls back to typed details when one is present', () => {
    expect(parseRequestCodesBody({ invite: 'short' }).ok).toBe(false);
    expect(parseRequestCodesBody({ invite: 'bad token!', email: 'a@b.com', mobile: '0412345678' }).ok).toBe(false);
  });
  it('accepts typed email + mobile, trimmed', () => {
    expect(parseRequestCodesBody({ email: ' jane@gmail.com ', mobile: ' 0412 345 678 ' }))
      .toEqual({ ok: true, input: { via: 'typed', email: 'jane@gmail.com', mobile: '0412 345 678' } });
  });
  it('requires both, and valid ones', () => {
    expect(parseRequestCodesBody({ email: 'jane@gmail.com' }).ok).toBe(false);
    expect(parseRequestCodesBody({ mobile: '0412345678' }).ok).toBe(false);
    expect(parseRequestCodesBody({ email: 'nope', mobile: '0412345678' })).toMatchObject({ ok: false, error: expect.stringMatching(/email/i) });
    expect(parseRequestCodesBody({ email: 'a@b.com', mobile: '0212345678' })).toMatchObject({ ok: false, error: expect.stringMatching(/mobile/i) });
    expect(parseRequestCodesBody({ email: `${'a'.repeat(250)}@b.com`, mobile: '0412345678' }).ok).toBe(false);
  });
  it('survives junk bodies', () => {
    for (const body of [null, undefined, 'x', 42, [], { email: 5, mobile: {} }]) expect(parseRequestCodesBody(body).ok).toBe(false);
  });
});

describe('parseVerifyBody', () => {
  it('accepts a uuid and two 6-digit codes', () => {
    expect(parseVerifyBody({ verificationId: VID, emailCode: '123456', smsCode: '000042' }))
      .toEqual({ ok: true, input: { verificationId: VID, emailCode: '123456', smsCode: '000042' } });
  });
  it('rejects a bad id, and each code that is not exactly 6 digits, naming the right box', () => {
    expect(parseVerifyBody({ verificationId: 'x', emailCode: '123456', smsCode: '123456' }).ok).toBe(false);
    expect(parseVerifyBody({ verificationId: VID, emailCode: '12345', smsCode: '123456' })).toMatchObject({ ok: false, error: expect.stringMatching(/email/) });
    expect(parseVerifyBody({ verificationId: VID, emailCode: '123456', smsCode: '12a456' })).toMatchObject({ ok: false, error: expect.stringMatching(/text message/) });
    expect(parseVerifyBody(null).ok).toBe(false);
  });
});

describe('format helpers', () => {
  it('recognises tokens, uuids and mobiles', () => {
    expect(isInviteToken(TOKEN)).toBe(true);
    expect(isInviteToken(`${TOKEN}!`)).toBe(false);
    expect(isVerificationId(VID)).toBe(true);
    expect(isVerificationId('nope')).toBe(false);
    for (const m of ['0412345678', '0412 345 678', '+61412345678']) expect(isAustralianMobile(m)).toBe(true);
    for (const m of ['0212345678', '041234567', '']) expect(isAustralianMobile(m)).toBe(false);
  });
});
