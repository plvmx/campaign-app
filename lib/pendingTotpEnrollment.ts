/**
 * Remembers the authenticator (TOTP) setup key shown by MfaEnrollmentFlow
 * across a page reload. Setting up on a phone means leaving the page to add
 * the key to the authenticator app, and iPhone reloads the page on return.
 * Each page load used to unenroll the unfinished authenticator and create a
 * *new* one — so the key already sitting in the person's app no longer
 * matched, and every code they typed failed (an iPhone leader entered seven,
 * 2026-10-13). Supabase only returns the secret at enrollment time, so it has
 * to be kept here. It belongs to an *unverified* factor of the signed-in
 * session's own account (the flow checks it still exists there before reusing
 * it), is the same value already on screen, expires quickly, and is cleared
 * the moment setup finishes, is cancelled, or times out.
 */
const STORAGE_KEY = 'afj_pending_totp_enrollment';
const MAX_AGE_MS = 15 * 60 * 1000;

export interface PendingTotpEnrollment {
  factorId: string;
  uri: string;
  secret: string;
}

export function clearPendingTotpEnrollment(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore (e.g. private browsing) */ }
}

export function savePendingTotpEnrollment(value: PendingTotpEnrollment, now: number = Date.now()): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...value, savedAt: now }));
  } catch { /* ignore (e.g. private browsing) */ }
}

/** The remembered setup, or null if none / expired / malformed (the latter two are also cleared). */
export function readPendingTotpEnrollment(now: number = Date.now()): PendingTotpEnrollment | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { factorId?: unknown; uri?: unknown; secret?: unknown; savedAt?: unknown };
    const fresh = typeof p.savedAt === 'number' && now - p.savedAt <= MAX_AGE_MS;
    if (fresh && typeof p.factorId === 'string' && typeof p.uri === 'string' && typeof p.secret === 'string') {
      return { factorId: p.factorId, uri: p.uri, secret: p.secret };
    }
    localStorage.removeItem(STORAGE_KEY);
    return null;
  } catch {
    clearPendingTotpEnrollment();
    return null;
  }
}
