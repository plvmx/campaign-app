/**
 * Input rules for the member sign-in screens (docs/member-portal/SIGN_IN_DESIGN.md §11),
 * kept out of the components so they can be unit tested and reused. The server
 * re-validates every request (lib/memberSignInInput.ts) — these checks are for usability.
 *
 * Rules:
 * - Email: required, no spaces, max 254 characters, a valid address.
 * - Mobile: required, only digits / spaces / a leading "+", max 16 characters,
 *   must be an Australian mobile (04XX XXX XXX or +614…).
 * - Each code: required, digits only, exactly 6.
 */
import { isValidEmail } from './emailFormat';
import { isAustralianMobile, MEMBER_CODE_LENGTH, MEMBER_EMAIL_MAX_LENGTH } from './memberFormat';
import { normalizeOtpInput } from './otpInput';

export const MEMBER_MOBILE_MAX_LENGTH = 16;

/** Restrict what can be typed into the email box: no whitespace, capped length. */
export function normalizeEmailInput(raw: string): string {
  return raw.replace(/\s/g, '').slice(0, MEMBER_EMAIL_MAX_LENGTH);
}

/** Restrict the mobile box to digits, spaces and a single leading "+". */
export function normalizeMobileInput(raw: string): string {
  const cleaned = raw.replace(/[^\d\s+]/g, '');
  const plus = cleaned.startsWith('+') ? '+' : '';
  return (plus + cleaned.replace(/\+/g, '')).slice(0, MEMBER_MOBILE_MAX_LENGTH);
}

/** Restrict a code box to digits, at most 6 (pasted codes with stray spaces/labels are cleaned, not truncated first). */
export const normalizeMemberCodeInput = (raw: string): string => normalizeOtpInput(raw, MEMBER_CODE_LENGTH);

export interface DetailsValues { email: string; mobile: string }
export type DetailsErrors = Partial<Record<keyof DetailsValues, string>>;

export function validateDetailsField(field: keyof DetailsValues, value: string): string | null {
  const v = value.trim();
  if (field === 'email') {
    if (!v) return 'Please enter your email address.';
    return isValidEmail(v) ? null : 'Please check your email address — it should look like name@example.com.';
  }
  if (!v) return 'Please enter your mobile number.';
  return isAustralianMobile(v) ? null : 'Please check your mobile number — it should look like 0412 345 678.';
}

export function validateDetails(values: DetailsValues): DetailsErrors {
  const errors: DetailsErrors = {};
  const email = validateDetailsField('email', values.email);
  const mobile = validateDetailsField('mobile', values.mobile);
  if (email) errors.email = email;
  if (mobile) errors.mobile = mobile;
  return errors;
}

export interface CodeValues { emailCode: string; smsCode: string }
export type CodeErrors = Partial<Record<keyof CodeValues, string>>;

export function validateCodeField(field: keyof CodeValues, value: string): string | null {
  const where = field === 'emailCode' ? 'email' : 'text message';
  if (!value) return `Please type the code from the ${where}.`;
  return value.length === MEMBER_CODE_LENGTH ? null : `The code from the ${where} has ${MEMBER_CODE_LENGTH} digits.`;
}

export function validateCodes(values: CodeValues): CodeErrors {
  const errors: CodeErrors = {};
  const email = validateCodeField('emailCode', values.emailCode);
  const sms = validateCodeField('smsCode', values.smsCode);
  if (email) errors.emailCode = email;
  if (sms) errors.smsCode = sms;
  return errors;
}

export const hasFormErrors = (errors: Record<string, string | undefined>): boolean => Object.values(errors).some(Boolean);
