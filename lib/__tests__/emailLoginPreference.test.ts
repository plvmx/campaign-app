import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: {}, from: vi.fn() } }));

import { rememberEmailLogin, shouldSkipToEmailLogin, PREFERS_EMAIL_MFA_LOGIN_KEY } from '../emailLoginPreference';

beforeEach(() => localStorage.clear());

describe('rememberEmailLogin / shouldSkipToEmailLogin', () => {
  it('does nothing until someone has signed in with email', () => {
    expect(shouldSkipToEmailLogin({ requireTwoFactor: false })).toBe(false);
    expect(shouldSkipToEmailLogin({ requireTwoFactor: true })).toBe(false);
  });

  it('sends an admin straight to email sign-in on every signed-out visit', () => {
    rememberEmailLogin('AD');
    expect(shouldSkipToEmailLogin({ requireTwoFactor: false })).toBe(true);
    rememberEmailLogin('SR');
    expect(shouldSkipToEmailLogin({ requireTwoFactor: false })).toBe(true);
  });

  it('keeps showing a plain leader the mobile+name form by default (the PVTester bounce)', () => {
    rememberEmailLogin(null);
    expect(shouldSkipToEmailLogin({ requireTwoFactor: false })).toBe(false);
  });

  it('still skips a plain leader to email sign-in when they arrive from "extra security needed"', () => {
    rememberEmailLogin(null);
    expect(shouldSkipToEmailLogin({ requireTwoFactor: true })).toBe(true);
  });

  it('treats junk in the admin column as a plain leader', () => {
    rememberEmailLogin('N');
    expect(shouldSkipToEmailLogin({ requireTwoFactor: false })).toBe(false);
  });

  it('never downgrades an admin device when the same person later picks a plain role', () => {
    rememberEmailLogin('AD');
    rememberEmailLogin(null);
    expect(shouldSkipToEmailLogin({ requireTwoFactor: false })).toBe(true);
  });

  it('reads the old "1" marker as the weaker strength, so existing plain-leader devices stop bouncing', () => {
    localStorage.setItem(PREFERS_EMAIL_MFA_LOGIN_KEY, '1');
    expect(shouldSkipToEmailLogin({ requireTwoFactor: false })).toBe(false);
    expect(shouldSkipToEmailLogin({ requireTwoFactor: true })).toBe(true);
  });

  it('the next admin email sign-in upgrades an old "1" marker', () => {
    localStorage.setItem(PREFERS_EMAIL_MFA_LOGIN_KEY, '1');
    rememberEmailLogin('AD');
    expect(shouldSkipToEmailLogin({ requireTwoFactor: false })).toBe(true);
  });
});
