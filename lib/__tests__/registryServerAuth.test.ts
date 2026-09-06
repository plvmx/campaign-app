import { describe, it, expect } from 'vitest';
import { decodeAalFromAccessToken } from '../registryServerAuth';

function fakeJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fake-signature-not-verified-by-this-function`;
}

describe('decodeAalFromAccessToken', () => {
  it('reads aal2 from a valid token payload', () => {
    expect(decodeAalFromAccessToken(fakeJwt({ aal: 'aal2', sub: 'user-1' }))).toBe('aal2');
  });

  it('reads aal1 from a valid token payload', () => {
    expect(decodeAalFromAccessToken(fakeJwt({ aal: 'aal1', sub: 'user-1' }))).toBe('aal1');
  });

  it('returns null when the aal claim is missing', () => {
    expect(decodeAalFromAccessToken(fakeJwt({ sub: 'user-1' }))).toBeNull();
  });

  it('returns null when the aal claim is an unrecognized value', () => {
    expect(decodeAalFromAccessToken(fakeJwt({ aal: 'aal3', sub: 'user-1' }))).toBeNull();
  });

  it('returns null for a malformed token (not three dot-separated segments)', () => {
    expect(decodeAalFromAccessToken('not-a-real-token')).toBeNull();
  });

  it('returns null for a token whose payload segment is not valid base64/JSON', () => {
    expect(decodeAalFromAccessToken('header.%%%not-base64%%%.signature')).toBeNull();
  });
});
