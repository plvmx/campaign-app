/** Basic email shape check, kept free of imports so server-side settings code can use it without pulling in the browser Supabase client. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True if the value is a plausible email address (deliberately loose — real deliverability is confirmed by sending). */
export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}
