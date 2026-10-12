import type { StateLeaderMatch } from '@/lib/auth';

/**
 * Remembers the login page's "Check your inbox" screen (email confirmation or
 * 2FA setup) across a page reload. To read the emailed code a leader has to
 * leave the app for their mail program — and a phone browser (iPhone Safari
 * and installed web apps especially) often reloads the page when they come
 * back. /login then found them already signed in and sent them straight to
 * /app, so they never got to type the code (reported by a leader on an
 * iPhone, 2026-10-12). Stored in localStorage — it survives the page being
 * discarded — with a short expiry, and holds only the leader row the page
 * already had (no tokens or secrets).
 */
const STORAGE_KEY = 'afj_pending_login_step';
const MAX_AGE_MS = 30 * 60 * 1000;

export type PendingLoginStep =
  | { kind: 'email'; match: StateLeaderMatch; value: string }
  | { kind: 'mfa'; match: StateLeaderMatch };

function isMatch(value: unknown): value is StateLeaderMatch {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return typeof m.id === 'string' && typeof m.state === 'string' && typeof m.leader === 'string';
}

export function clearPendingLoginStep(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore (e.g. private browsing) */ }
}

export function savePendingLoginStep(step: PendingLoginStep, now: number = Date.now()): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...step, savedAt: now }));
  } catch { /* ignore (e.g. private browsing) */ }
}

/** The remembered step, or null if there is none, it has expired, or it is malformed (which is also cleared). */
export function readPendingLoginStep(now: number = Date.now()): PendingLoginStep | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { kind?: unknown; match?: unknown; value?: unknown; savedAt?: unknown };
    const fresh = typeof parsed.savedAt === 'number' && now - parsed.savedAt <= MAX_AGE_MS;
    if (fresh && isMatch(parsed.match)) {
      if (parsed.kind === 'email' && typeof parsed.value === 'string') {
        return { kind: 'email', match: parsed.match, value: parsed.value };
      }
      if (parsed.kind === 'mfa') return { kind: 'mfa', match: parsed.match };
    }
    localStorage.removeItem(STORAGE_KEY);
    return null;
  } catch {
    clearPendingLoginStep();
    return null;
  }
}
