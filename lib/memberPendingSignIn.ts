/**
 * Remembers, on this device only, that a member has been sent sign-in codes —
 * so an iPhone/Android that reloads the page while they go and read the email
 * or text doesn't lose their place (and force a second send, which is rate
 * limited and costs an SMS). Same idea as lib/pendingLoginStep.ts.
 *
 * What is kept: the verification id (useless without both codes), the MASKED
 * details shown on screen, and when it was saved — never a code and never the
 * real email or mobile. Expires with the codes themselves (10 minutes).
 * Never throws when storage is blocked.
 */
import { isVerificationId } from './memberSignInInput';

export const MEMBER_PENDING_KEY = 'member_pending_sign_in_v1';
export const MEMBER_PENDING_TTL_MS = 10 * 60 * 1000;

export interface PendingMemberSignIn {
  verificationId: string;
  maskedEmail: string;
  maskedMobile: string;
  via: 'invite' | 'typed';
  savedAt: number;
}

const safeStorage = (): Storage | null => {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
};

export function saveMemberPending(p: Omit<PendingMemberSignIn, 'savedAt'>, now: number = Date.now(), storage: Storage | null = safeStorage()): void {
  try { storage?.setItem(MEMBER_PENDING_KEY, JSON.stringify({ ...p, savedAt: now })); } catch { /* blocked or full — the draft is a convenience */ }
}

export function clearMemberPending(storage: Storage | null = safeStorage()): void {
  try { storage?.removeItem(MEMBER_PENDING_KEY); } catch { /* ignore */ }
}

/** The remembered step if it is well-formed and unexpired; anything else is cleared and null. */
export function loadMemberPending(now: number = Date.now(), storage: Storage | null = safeStorage()): PendingMemberSignIn | null {
  try {
    const raw = storage?.getItem(MEMBER_PENDING_KEY);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    const ok =
      isVerificationId(o.verificationId) &&
      typeof o.maskedEmail === 'string' && o.maskedEmail.length <= 100 &&
      typeof o.maskedMobile === 'string' && o.maskedMobile.length <= 100 &&
      (o.via === 'invite' || o.via === 'typed') &&
      typeof o.savedAt === 'number' && o.savedAt <= now && now - o.savedAt < MEMBER_PENDING_TTL_MS;
    if (!ok) { clearMemberPending(storage); return null; }
    return o as unknown as PendingMemberSignIn;
  } catch {
    clearMemberPending(storage);
    return null;
  }
}
