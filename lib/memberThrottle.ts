/**
 * Limits on how often sign-in codes may be sent (docs/member-portal/SIGN_IN_DESIGN.md §8).
 * SMS is a paid channel, so these are decided from counts read out of
 * registry.member_auth_events (durable) rather than the app's in-memory rate
 * limiter, which resets on every cold start. Pure — the service supplies the counts.
 */

export const MEMBER_THROTTLE = {
  /** Minimum gap between two sends to the same person. */
  resendCooldownMs: 60 * 1000,
  perPersonWindowMs: 15 * 60 * 1000,
  perPersonWindowMax: 3,
  perPersonDayMax: 10,
  perIpWindowMs: 60 * 60 * 1000,
  // Generous on purpose: members at one event or church share a Wi-Fi/carrier address. The per-person
  // limits and the daily text ceiling are what actually cap cost; this only blunts one address hammering.
  perIpWindowMax: 30,
  /** Default for the global ceiling; an admin can override via app_settings `member_sms_daily_ceiling`. */
  defaultDailySmsCeiling: 1500,
} as const;

export interface SendCounts {
  /** Sends to this person in the last `resendCooldownMs`. */
  recentCooldown: number;
  /** Sends to this person in the last `perPersonWindowMs`. */
  personWindow: number;
  /** Sends to this person in the last 24 hours. */
  personDay: number;
  /** Sends from this IP in the last `perIpWindowMs`. */
  ipWindow: number;
  /** Text messages sent by anyone in the last 24 hours. */
  smsToday: number;
}

export type ThrottleDecision =
  | { allowed: true }
  | { allowed: false; reason: 'cooldown' | 'person_window' | 'person_day' | 'ip' | 'sms_ceiling' };

export function decideSend(counts: SendCounts, smsCeiling: number = MEMBER_THROTTLE.defaultDailySmsCeiling): ThrottleDecision {
  if (counts.recentCooldown >= 1) return { allowed: false, reason: 'cooldown' };
  if (counts.personWindow >= MEMBER_THROTTLE.perPersonWindowMax) return { allowed: false, reason: 'person_window' };
  if (counts.personDay >= MEMBER_THROTTLE.perPersonDayMax) return { allowed: false, reason: 'person_day' };
  if (counts.ipWindow >= MEMBER_THROTTLE.perIpWindowMax) return { allowed: false, reason: 'ip' };
  if (counts.smsToday >= smsCeiling) return { allowed: false, reason: 'sms_ceiling' };
  return { allowed: true };
}
