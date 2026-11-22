import { describe, it, expect } from 'vitest';
import { generateCode, generateToken, getMemberAuthSecret, hashCode, hashIp, hashToken, verifyCode } from '../memberCodes';

const SECRET = 'k'.repeat(40);

describe('generateCode', () => {
  it('is always exactly 6 digits, keeping leading zeros', () => {
    for (let i = 0; i < 500; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });
});

describe('verifyCode', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const stored = hashCode('004821', id, 'email', SECRET);

  it('accepts the right code only', () => {
    expect(verifyCode('004821', stored, id, 'email', SECRET)).toBe(true);
    expect(verifyCode('004822', stored, id, 'email', SECRET)).toBe(false);
  });
  it('binds a code to its channel, its verification and the secret', () => {
    expect(verifyCode('004821', stored, id, 'sms', SECRET)).toBe(false);
    expect(verifyCode('004821', stored, '22222222-2222-4222-8222-222222222222', 'email', SECRET)).toBe(false);
    expect(verifyCode('004821', stored, id, 'email', 'z'.repeat(40))).toBe(false);
  });
  it('rejects wrong-shaped input and a damaged stored hash without throwing', () => {
    for (const typed of ['', '12345', '1234567', 'abcdef', '12 345']) expect(verifyCode(typed, stored, id, 'email', SECRET)).toBe(false);
    expect(verifyCode('004821', 'not-hex', id, 'email', SECRET)).toBe(false);
    expect(verifyCode('004821', '', id, 'email', SECRET)).toBe(false);
  });
});

describe('tokens and hashes', () => {
  it('makes unguessable, distinct URL-safe tokens', () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });
  it('hashes tokens deterministically, never to the token itself', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toContain('abc');
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });
  it('hashes an IP with the secret, truncated, without revealing it', () => {
    const h = hashIp('203.0.113.9', SECRET);
    expect(h).toHaveLength(32);
    expect(h).not.toContain('203');
    expect(hashIp('203.0.113.9', 'z'.repeat(40))).not.toBe(h);
  });
});

describe('getMemberAuthSecret', () => {
  it('refuses a missing or short secret rather than weakening sign-in', () => {
    expect(() => getMemberAuthSecret({} as NodeJS.ProcessEnv)).toThrow(/MEMBER_AUTH_SECRET/);
    expect(() => getMemberAuthSecret({ MEMBER_AUTH_SECRET: 'short' } as unknown as NodeJS.ProcessEnv)).toThrow(/MEMBER_AUTH_SECRET/);
    expect(getMemberAuthSecret({ MEMBER_AUTH_SECRET: SECRET } as unknown as NodeJS.ProcessEnv)).toBe(SECRET);
  });
});
