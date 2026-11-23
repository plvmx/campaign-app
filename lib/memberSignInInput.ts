/**
 * Parsing and validation of what the member sign-in routes receive
 * (docs/member-portal/SIGN_IN_DESIGN.md §6). Shared by the routes and the
 * sign-in page so both apply the same rules; the routes re-validate because
 * client checks are for usability only.
 *
 * Rules: an invite token is 20–100 URL-safe characters; typed contact details
 * are a valid email and a valid Australian mobile (04XX XXX XXX); each sign-in
 * code is exactly 6 digits; a verification id is a UUID.
 */
import { isValidEmail } from './emailFormat';
import { isAustralianMobile, MEMBER_CODE_LENGTH, MEMBER_EMAIL_MAX_LENGTH } from './memberFormat';

export { isAustralianMobile };

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,100}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isInviteToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

export function isVerificationId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export type RequestCodesInput =
  | { via: 'invite'; inviteToken: string }
  | { via: 'typed'; email: string; mobile: string };

export type ParsedRequestCodes = { ok: true; input: RequestCodesInput } | { ok: false; error: string };

export function parseRequestCodesBody(body: unknown): ParsedRequestCodes {
  const obj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

  if (obj.invite !== undefined) {
    return isInviteToken(obj.invite)
      ? { ok: true, input: { via: 'invite', inviteToken: obj.invite } }
      : { ok: false, error: 'This link is not valid.' };
  }

  const email = typeof obj.email === 'string' ? obj.email.trim() : '';
  const mobile = typeof obj.mobile === 'string' ? obj.mobile.trim() : '';
  if (!email || !mobile) return { ok: false, error: 'Please enter your email address and your mobile number.' };
  if (email.length > MEMBER_EMAIL_MAX_LENGTH || !isValidEmail(email)) return { ok: false, error: 'Please check your email address.' };
  if (!isAustralianMobile(mobile)) return { ok: false, error: 'Please check your mobile number (for example 0412 345 678).' };
  return { ok: true, input: { via: 'typed', email, mobile } };
}

export interface VerifyInput { verificationId: string; emailCode: string; smsCode: string }
export type ParsedVerify = { ok: true; input: VerifyInput } | { ok: false; error: string };

const CODE_PATTERN = new RegExp(`^\\d{${MEMBER_CODE_LENGTH}}$`);

export function parseVerifyBody(body: unknown): ParsedVerify {
  const obj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (!isVerificationId(obj.verificationId)) return { ok: false, error: 'Please ask for new codes and try again.' };
  const emailCode = typeof obj.emailCode === 'string' ? obj.emailCode.trim() : '';
  const smsCode = typeof obj.smsCode === 'string' ? obj.smsCode.trim() : '';
  if (!CODE_PATTERN.test(emailCode)) return { ok: false, error: `Enter the ${MEMBER_CODE_LENGTH}-digit code from the email.` };
  if (!CODE_PATTERN.test(smsCode)) return { ok: false, error: `Enter the ${MEMBER_CODE_LENGTH}-digit code from the text message.` };
  return { ok: true, input: { verificationId: obj.verificationId, emailCode, smsCode } };
}
