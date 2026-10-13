/**
 * "Get help" for leaders stuck on email confirmation / 2FA setup. The
 * support number comes from NEXT_PUBLIC_SUPPORT_MOBILE (set in Vercel and
 * redeployed — it is inlined at build time); if unset, only the step-by-step
 * guide is offered. The text message is pre-filled with which step the person
 * is on and who they are, so whoever answers doesn't have to ask.
 */
export const HELP_GUIDE_PATH = '/help/2fa';

/** An Australian-style or international mobile → "+614…"; null if it has no digits. */
export function toSupportNumber(raw: string | undefined | null): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  if (digits.startsWith('61')) return `+${digits}`;
  if (digits.startsWith('0')) return `+61${digits.slice(1)}`;
  return `+${digits}`;
}

export function buildHelpMessage(step: string, who?: string | null): string {
  const name = who?.trim();
  return `Hi, I need help with my AFJ app sign-in setup.${name ? ` I'm ${name}.` : ''} I'm stuck at: ${step}.`;
}

/** An `sms:` link that works on both iPhone and Android, or null when no number is configured. */
export function getSupportSmsHref(
  message: string,
  rawNumber: string | undefined | null = process.env.NEXT_PUBLIC_SUPPORT_MOBILE,
): string | null {
  const number = toSupportNumber(rawNumber);
  if (!number) return null;
  return `sms:${number}?&body=${encodeURIComponent(message)}`;
}
