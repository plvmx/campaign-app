import { isRecognizedAdminStatus } from '@/lib/campaignFilter';

/**
 * What the mobile+name login must do for a matched leader instead of
 * signing them in. Admins (AD and SR) may only sign in with email + an
 * authenticator code, so the legacy form never gives them an app session:
 * an enrolled admin is sent to email sign-in, an unenrolled one must set up
 * 2FA first (the same email-confirm + MFA-setup steps every leader is offered,
 * minus the "skip"). Plain leaders return null and sign in as before.
 * The server enforces the same rule (sessionAccessService.ts) — this only
 * decides which screen to show.
 */
export type AdminLoginGate = 'sign-in-with-email' | 'set-up-2fa';

export function getAdminLoginGate(match: {
  admin: string | null;
  mfaEnrolledAt: string | null;
}): AdminLoginGate | null {
  if (!isRecognizedAdminStatus(match.admin)) return null;
  return match.mfaEnrolledAt ? 'sign-in-with-email' : 'set-up-2fa';
}
