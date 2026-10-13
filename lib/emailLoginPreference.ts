import { isRecognizedAdminStatus } from '@/lib/campaignFilter';

/**
 * Remembers, per browser, that this device signs in via email + 2FA
 * (app/login/mfa), so /login can skip its mobile+name form instead of making
 * a returning visitor click through to it. Set by app/login/mfa/callback/page.tsx
 * after a successful sign-in; never cleared on sign-out (same precedent as /login's
 * remembered mobile/name).
 *
 * Two strengths, because the two kinds of leader differ:
 *  - 'always' — an admin (AD/SR). They cannot use mobile+name at all, so every
 *    signed-out visit to /login goes straight to email sign-in.
 *  - 'when-required' — any other leader. Mobile+name still works for them (it
 *    just can't show members' personal details), so /login keeps showing it by
 *    default; the email sign-in is only skipped to when they arrive from the
 *    "extra security needed" screen (/login?require2fa=1). Before this, a plain
 *    leader who had tried 2FA once was bounced to email sign-in on every
 *    sign-out (reported 2026-10-13, testing PVTester).
 * An older marker (the literal '1', written before there were two strengths) reads
 * as 'when-required' — the safe reading, since an admin simply sees the mobile+name
 * screen once, is pointed at email sign-in, and the next email sign-in upgrades it.
 */
export const PREFERS_EMAIL_MFA_LOGIN_KEY = 'afj_prefers_email_mfa_login';

const ALWAYS = 'always';
const WHEN_REQUIRED = 'when-required';

/** Records a completed email + 2FA sign-in as the given leader row. Never weakens an existing 'always'. */
export function rememberEmailLogin(admin: string | null): void {
  try {
    const current = localStorage.getItem(PREFERS_EMAIL_MFA_LOGIN_KEY);
    const strength = isRecognizedAdminStatus(admin) || current === ALWAYS ? ALWAYS : WHEN_REQUIRED;
    localStorage.setItem(PREFERS_EMAIL_MFA_LOGIN_KEY, strength);
  } catch { /* ignore (e.g. private browsing) */ }
}

/** Whether /login should send a signed-out visitor straight to email sign-in. */
export function shouldSkipToEmailLogin(options: { requireTwoFactor: boolean }): boolean {
  try {
    const stored = localStorage.getItem(PREFERS_EMAIL_MFA_LOGIN_KEY);
    if (!stored) return false;
    return stored === ALWAYS || options.requireTwoFactor;
  } catch {
    return false;
  }
}
