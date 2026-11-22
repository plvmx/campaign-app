/**
 * Format rules for the member sign-in that are safe to import in the browser
 * (no Node crypto): shared by the server's input parsing
 * (lib/memberSignInInput.ts) and the sign-in screens' validation
 * (lib/memberSignInForm.ts) so the two can never disagree.
 */
import { normalizePhone } from './registryPipeline/phone';

/** Each sign-in code (email and text message) is exactly this many digits. */
export const MEMBER_CODE_LENGTH = 6;
export const MEMBER_EMAIL_MAX_LENGTH = 254;

/** An Australian mobile (04XX XXX XXX / +614…). Same rule as validation.ts's isValidMobile, without pulling the browser Supabase client in. */
export function isAustralianMobile(value: string): boolean {
  return /^\+614\d{8}$/.test(normalizePhone(value) ?? '');
}
