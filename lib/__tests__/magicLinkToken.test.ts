import { describe, it, expect, afterEach } from 'vitest';
import { readTokenHashFromUrl, stripTokenHashFromUrl } from '../magicLinkToken';

afterEach(() => window.history.replaceState(null, '', '/'));

describe('readTokenHashFromUrl', () => {
  it('reads the token hash from a query string', () => {
    expect(readTokenHashFromUrl('?via=email&token_hash=abc123&type=email')).toBe('abc123');
  });

  it('returns null when absent or empty', () => {
    expect(readTokenHashFromUrl('?via=email')).toBeNull();
    expect(readTokenHashFromUrl('?token_hash=')).toBeNull();
    expect(readTokenHashFromUrl('')).toBeNull();
  });

  it('rejects an absurdly long value', () => {
    expect(readTokenHashFromUrl(`?token_hash=${'a'.repeat(500)}`)).toBeNull();
  });

  it('reads from the current location by default', () => {
    window.history.replaceState(null, '', '/setup-mfa?via=email&token_hash=xyz&type=email');
    expect(readTokenHashFromUrl()).toBe('xyz');
  });
});

describe('stripTokenHashFromUrl', () => {
  it('removes token_hash and type but keeps other params and the path', () => {
    window.history.replaceState(null, '', '/confirm-email?leaderId=42&token_hash=abc&type=email');
    stripTokenHashFromUrl();
    expect(window.location.pathname).toBe('/confirm-email');
    expect(window.location.search).toBe('?leaderId=42');
  });

  it('does nothing when there is no token', () => {
    window.history.replaceState(null, '', '/setup-mfa?via=email');
    stripTokenHashFromUrl();
    expect(window.location.search).toBe('?via=email');
  });
});
