/**
 * True on an iPhone, iPod or iPad. The authenticator setup screen uses it to
 * lead with the typed setup key: on iOS an `otpauth://` link is as likely to
 * open Apple's Passwords app (or nothing) as Google/Microsoft Authenticator,
 * and a QR code on the phone's own screen can't be scanned (Mark, an admin on
 * iPhone, couldn't complete setup this way, 2026-10-19). iPadOS 13+ reports
 * itself as a Mac, so a "Mac" with a touch screen counts too.
 */
export function isIosDevice(nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> | undefined =
  typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!nav) return false;
  if (/iPhone|iPad|iPod/i.test(nav.userAgent)) return true;
  return nav.platform === 'MacIntel' && nav.maxTouchPoints > 1;
}
