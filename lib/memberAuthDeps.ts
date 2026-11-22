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

/** Reads the ceiling setting; anything that isn't a positive whole number falls back to the default. */
export function parseSmsCeiling(raw: string | null): number {
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : MEMBER_THROTTLE.defaultDailySmsCeiling;
}

/** Throws if MEMBER_AUTH_SECRET isn't configured — callers turn that into a 500, never a weaker sign-in. */
export async function buildMemberAuthDeps(): Promise<MemberAuthDeps> {
  return {
    secret: getMemberAuthSecret(),
    sendEmail: (email) => sendEmail(email),
    sendSms: (to, body) => sendSms(to, body),
    smsCeiling: parseSmsCeiling(await getSettingServer(MEMBER_SMS_CEILING_SETTING)),
  };
}
