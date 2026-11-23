/**
 * Wires the member sign-in service (lib/services/memberAuthService.ts) to the
 * real providers: Resend for the email, ClickSend for the text message, and
 * the admin-adjustable global SMS ceiling from app_settings. Server-only.
 */
import { getMemberAuthSecret } from '@/lib/memberCodes';
import { MEMBER_THROTTLE } from '@/lib/memberThrottle';
import { sendEmail } from '@/lib/resendClient';
import { sendSms } from '@/lib/clickSendClient';
import { getSettingServer } from '@/lib/appSettings';
import type { MemberAuthDeps } from '@/lib/services/memberAuthService';

export const MEMBER_SMS_CEILING_SETTING = 'member_sms_daily_ceiling';

/** Sender shown on member sign-in emails. Override with MEMBER_EMAIL_FROM (must be on a Resend-verified domain). */
export const DEFAULT_MEMBER_EMAIL_FROM = 'AFJ <noreply@afj.org.au>';

export function getMemberEmailFrom(raw: string | undefined | null = process.env.MEMBER_EMAIL_FROM): string {
  const v = (raw ?? '').trim();
  return v || DEFAULT_MEMBER_EMAIL_FROM;
}

/**
 * The alphanumeric sender ID for member sign-in texts (MEMBER_SMS_SENDER_ID, e.g. "AFJ"):
 * 1–11 letters/digits/spaces with at least one letter. Unset (or invalid) → null, meaning
 * ClickSend's account default number is used. Leave it unset until the ID is registered with
 * ClickSend and the ACMA — an unregistered name is shown as "Unverified" or can be rejected.
 */
export function parseSmsSenderId(raw: string | undefined | null = process.env.MEMBER_SMS_SENDER_ID): string | null {
  const v = (raw ?? '').trim();
  return /^(?=.*[A-Za-z])[A-Za-z0-9 ]{1,11}$/.test(v) ? v : null;
}

/** Reads the ceiling setting; anything that isn't a positive whole number falls back to the default. */
export function parseSmsCeiling(raw: string | null): number {
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : MEMBER_THROTTLE.defaultDailySmsCeiling;
}

/** Throws if MEMBER_AUTH_SECRET isn't configured — callers turn that into a 500, never a weaker sign-in. */
export async function buildMemberAuthDeps(): Promise<MemberAuthDeps> {
  const senderRaw = (process.env.MEMBER_SMS_SENDER_ID ?? '').trim();
  const senderId = parseSmsSenderId(senderRaw);
  if (senderRaw && !senderId) console.warn('MEMBER_SMS_SENDER_ID is not a valid sender ID (1-11 letters/digits, at least one letter) — using the account default');
  return {
    secret: getMemberAuthSecret(),
    sendEmail: (email) => sendEmail({ ...email, from: getMemberEmailFrom() }),
    sendSms: (to, body) => sendSms(to, body, senderId ? { from: senderId } : {}),
    smsCeiling: parseSmsCeiling(await getSettingServer(MEMBER_SMS_CEILING_SETTING)),
  };
}
