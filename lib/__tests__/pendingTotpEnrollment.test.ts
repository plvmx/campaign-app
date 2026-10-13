import { describe, it, expect, beforeEach } from 'vitest';
import { clearPendingTotpEnrollment, readPendingTotpEnrollment, savePendingTotpEnrollment } from '../pendingTotpEnrollment';

const VALUE = { factorId: 'f1', uri: 'otpauth://totp/AFJ:a@x.com?secret=ABC', secret: 'ABC' };
const T0 = 5_000_000;

beforeEach(() => localStorage.clear());

describe('pendingTotpEnrollment', () => {
  it('round-trips a setup', () => {
    savePendingTotpEnrollment(VALUE, T0);
    expect(readPendingTotpEnrollment(T0 + 1000)).toEqual(VALUE);
  });

  it('expires after 15 minutes and clears itself', () => {
    savePendingTotpEnrollment(VALUE, T0);
    expect(readPendingTotpEnrollment(T0 + 16 * 60 * 1000)).toBeNull();
    expect(localStorage.getItem('afj_pending_totp_enrollment')).toBeNull();
  });

  it('is still there just inside 15 minutes', () => {
    savePendingTotpEnrollment(VALUE, T0);
    expect(readPendingTotpEnrollment(T0 + 14 * 60 * 1000)).toEqual(VALUE);
  });

  it('returns null when nothing is stored', () => {
    expect(readPendingTotpEnrollment()).toBeNull();
  });

  it('ignores and clears malformed data', () => {
    localStorage.setItem('afj_pending_totp_enrollment', '{nope');
    expect(readPendingTotpEnrollment()).toBeNull();
    localStorage.setItem('afj_pending_totp_enrollment', JSON.stringify({ factorId: 1, uri: 'x', secret: 'y', savedAt: Date.now() }));
    expect(readPendingTotpEnrollment()).toBeNull();
    expect(localStorage.getItem('afj_pending_totp_enrollment')).toBeNull();
  });

  it('clearPendingTotpEnrollment removes it', () => {
    savePendingTotpEnrollment(VALUE);
    clearPendingTotpEnrollment();
    expect(readPendingTotpEnrollment()).toBeNull();
  });
});
