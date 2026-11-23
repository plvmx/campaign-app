import { describe, it, expect, beforeEach } from 'vitest';
import { clearMemberPending, loadMemberPending, saveMemberPending, MEMBER_PENDING_KEY, MEMBER_PENDING_TTL_MS } from '../memberPendingSignIn';

const VID = '11111111-1111-4111-8111-111111111111';
const pending = { verificationId: VID, maskedEmail: 'j•••@gmail.com', maskedMobile: '04•• ••• 678', via: 'typed' as const };
const T0 = 1_700_000_000_000;

beforeEach(() => localStorage.clear());

describe('member pending sign-in', () => {
  it('saves and restores the step, only masked details and the verification id', () => {
    saveMemberPending(pending, T0);
    const raw = localStorage.getItem(MEMBER_PENDING_KEY)!;
    expect(raw).not.toMatch(/jane@|0412/);
    expect(loadMemberPending(T0 + 1000)).toEqual({ ...pending, savedAt: T0 });
  });

  it('expires with the codes and clears what it discards', () => {
    saveMemberPending(pending, T0);
    expect(loadMemberPending(T0 + MEMBER_PENDING_TTL_MS)).toBeNull();
    expect(localStorage.getItem(MEMBER_PENDING_KEY)).toBeNull();
  });

  it('discards malformed, tampered or future-dated values', () => {
    for (const raw of ['not json', '{}', JSON.stringify({ ...pending, savedAt: T0, verificationId: 'nope' }),
      JSON.stringify({ ...pending, savedAt: T0, via: 'other' }), JSON.stringify({ ...pending, savedAt: T0 + 99999 })]) {
      localStorage.setItem(MEMBER_PENDING_KEY, raw);
      expect(loadMemberPending(T0)).toBeNull();
      expect(localStorage.getItem(MEMBER_PENDING_KEY)).toBeNull();
    }
  });

  it('can be cleared', () => {
    saveMemberPending(pending, T0);
    clearMemberPending();
    expect(loadMemberPending(T0)).toBeNull();
  });

  it('never throws when storage is blocked', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(() => saveMemberPending(pending, T0, blocked)).not.toThrow();
    expect(loadMemberPending(T0, blocked)).toBeNull();
    expect(() => clearMemberPending(blocked)).not.toThrow();
    expect(loadMemberPending(T0, null)).toBeNull();
  });
});
