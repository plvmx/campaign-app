import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: {}, from: vi.fn() } }));
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: {} }));

const sendEmailMock = vi.fn().mockResolvedValue({ messageId: 'e' });
const sendSmsMock = vi.fn().mockResolvedValue({ messageId: 's' });
vi.mock('@/lib/resendClient', () => ({ sendEmail: (...a: unknown[]) => sendEmailMock(...a) }));
vi.mock('@/lib/clickSendClient', () => ({ sendSms: (...a: unknown[]) => sendSmsMock(...a) }));
vi.mock('@/lib/appSettings', () => ({ getSettingServer: vi.fn().mockResolvedValue(null) }));

import { buildMemberAuthDeps, DEFAULT_MEMBER_EMAIL_FROM, getMemberEmailFrom, parseSmsCeiling, parseSmsSenderId } from '../memberAuthDeps';
import { MEMBER_THROTTLE } from '../memberThrottle';

describe('parseSmsCeiling', () => {
  it('uses a positive whole number', () => {
    expect(parseSmsCeiling('250')).toBe(250);
  });
  it('falls back to the default for anything else', () => {
    for (const raw of [null, '', 'abc', '0', '-5', '1.5']) expect(parseSmsCeiling(raw)).toBe(MEMBER_THROTTLE.defaultDailySmsCeiling);
  });
});

describe('getMemberEmailFrom', () => {
  it('defaults to AFJ (not TWOL) and honours an override', () => {
    expect(DEFAULT_MEMBER_EMAIL_FROM).toBe('AFJ <noreply@afj.org.au>');
    expect(getMemberEmailFrom(undefined)).toBe(DEFAULT_MEMBER_EMAIL_FROM);
    expect(getMemberEmailFrom('  ')).toBe(DEFAULT_MEMBER_EMAIL_FROM);
    expect(getMemberEmailFrom(' Australia For Jesus <hello@afj.org.au> ')).toBe('Australia For Jesus <hello@afj.org.au>');
  });
});

describe('parseSmsSenderId', () => {
  it('accepts 1-11 letters/digits/spaces with at least one letter', () => {
    for (const ok of ['AFJ', ' AFJ ', 'Aus4Jesus', 'AFJ Aus']) expect(parseSmsSenderId(ok)).toBe(ok.trim());
  });
  it('rejects anything a carrier would refuse, and unset, so the account default is used', () => {
    for (const bad of [undefined, null, '', '   ', '12345', 'ABCDEFGHIJKL', 'AF-J', 'AFJ!', '+61412345678']) expect(parseSmsSenderId(bad)).toBeNull();
  });
});

describe('buildMemberAuthDeps sender wiring', () => {
  const saved = { secret: process.env.MEMBER_AUTH_SECRET, from: process.env.MEMBER_EMAIL_FROM, sender: process.env.MEMBER_SMS_SENDER_ID };
  beforeEach(() => {
    process.env.MEMBER_AUTH_SECRET = 'x'.repeat(40);
    delete process.env.MEMBER_EMAIL_FROM;
    delete process.env.MEMBER_SMS_SENDER_ID;
    sendEmailMock.mockClear(); sendSmsMock.mockClear();
  });
  afterEach(() => {
    for (const [k, v] of [['MEMBER_AUTH_SECRET', saved.secret], ['MEMBER_EMAIL_FROM', saved.from], ['MEMBER_SMS_SENDER_ID', saved.sender]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  const email = { to: ['a@x.com'], subject: 'S', html: 'h', text: 't' };

  it('sends the member email from AFJ', async () => {
    await (await buildMemberAuthDeps()).sendEmail(email);
    expect(sendEmailMock.mock.calls[0][0]).toMatchObject({ ...email, from: 'AFJ <noreply@afj.org.au>' });
  });

  it('sends the text from the configured sender ID, and from the account default when unset', async () => {
    await (await buildMemberAuthDeps()).sendSms('+61412345678', 'code');
    expect(sendSmsMock).toHaveBeenLastCalledWith('+61412345678', 'code', {});
    process.env.MEMBER_SMS_SENDER_ID = 'AFJ';
    await (await buildMemberAuthDeps()).sendSms('+61412345678', 'code');
    expect(sendSmsMock).toHaveBeenLastCalledWith('+61412345678', 'code', { from: 'AFJ' });
  });

  it('ignores an invalid sender ID rather than failing sign-in', async () => {
    process.env.MEMBER_SMS_SENDER_ID = 'not valid!!';
    await (await buildMemberAuthDeps()).sendSms('+61412345678', 'code');
    expect(sendSmsMock).toHaveBeenLastCalledWith('+61412345678', 'code', {});
  });
});
