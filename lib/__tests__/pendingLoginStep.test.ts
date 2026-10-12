import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: {}, from: vi.fn() } }));

import { clearPendingLoginStep, readPendingLoginStep, savePendingLoginStep } from '../pendingLoginStep';
import type { StateLeaderMatch } from '../auth';

const MATCH: StateLeaderMatch = {
  id: 'sl-1', state: 'NSW', leader: 'Jack', mobile: null, admin: null,
  email: null, pendingEmail: 'jack@example.com', suggestedEmail: null, mfaEnrolledAt: null,
};
const T0 = 1_000_000;

beforeEach(() => localStorage.clear());

describe('pendingLoginStep', () => {
  it('round-trips an email step', () => {
    savePendingLoginStep({ kind: 'email', match: MATCH, value: 'jack@example.com' }, T0);
    expect(readPendingLoginStep(T0 + 1000)).toEqual({ kind: 'email', match: MATCH, value: 'jack@example.com' });
  });

  it('round-trips an MFA step', () => {
    savePendingLoginStep({ kind: 'mfa', match: MATCH }, T0);
    expect(readPendingLoginStep(T0 + 1000)).toEqual({ kind: 'mfa', match: MATCH });
  });

  it('expires after 30 minutes and clears itself', () => {
    savePendingLoginStep({ kind: 'mfa', match: MATCH }, T0);
    expect(readPendingLoginStep(T0 + 31 * 60 * 1000)).toBeNull();
    expect(localStorage.getItem('afj_pending_login_step')).toBeNull();
  });

  it('is still there just inside the 30 minutes', () => {
    savePendingLoginStep({ kind: 'mfa', match: MATCH }, T0);
    expect(readPendingLoginStep(T0 + 29 * 60 * 1000)).not.toBeNull();
  });

  it('returns null when nothing is stored', () => {
    expect(readPendingLoginStep()).toBeNull();
  });

  it('ignores and clears malformed data', () => {
    localStorage.setItem('afj_pending_login_step', '{not json');
    expect(readPendingLoginStep()).toBeNull();
    localStorage.setItem('afj_pending_login_step', JSON.stringify({ kind: 'email', match: { id: 5 }, value: 'x', savedAt: Date.now() }));
    expect(readPendingLoginStep()).toBeNull();
    localStorage.setItem('afj_pending_login_step', JSON.stringify({ kind: 'bogus', match: MATCH, savedAt: Date.now() }));
    expect(readPendingLoginStep()).toBeNull();
    expect(localStorage.getItem('afj_pending_login_step')).toBeNull();
  });

  it('clearPendingLoginStep removes it', () => {
    savePendingLoginStep({ kind: 'mfa', match: MATCH });
    clearPendingLoginStep();
    expect(readPendingLoginStep()).toBeNull();
  });
});
