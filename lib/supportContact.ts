/**
 * Support contact helpers for leaders stuck on email confirmation / 2FA setup.
 * The on-screen "Stuck?" line (components/auth/GetHelp.tsx) points at the guide
 * and the leaders' WhatsApp group; the number below (NEXT_PUBLIC_SUPPORT_MOBILE,
 * inlined at build time) is still shown on the printable guide (/help/2fa) and
 * used for the admin's Call / Text-a-reminder buttons.
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
