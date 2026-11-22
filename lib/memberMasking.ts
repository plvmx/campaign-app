/**
 * Masked display of a member's contact details on the sign-in screen — enough
 * for them to recognise which details we hold, not enough for a forwarded link
 * or a shoulder-surfer to learn them (docs/member-portal/SIGN_IN_DESIGN.md §4).
 */

const BULLET = '•';

/** "jane.smith@gmail.com" → "j•••@gmail.com". The domain stays visible so people can tell which address it is. */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at < 1) return BULLET.repeat(3);
  return `${trimmed[0]}${BULLET.repeat(3)}${trimmed.slice(at)}`;
}

/** "+61412345678" or "0412 345 678" → "04•• ••• 678" (last three digits only). */
export function maskMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  const national = digits.startsWith('61') ? `0${digits.slice(2)}` : digits;
  if (national.length < 6) return BULLET.repeat(3);
  const last3 = national.slice(-3);
  return `${national.slice(0, 2)}${BULLET.repeat(2)} ${BULLET.repeat(3)} ${last3}`;
}
