// Authenticator-app (TOTP) codes are always 6 digits.
export const OTP_CODE_LENGTH = 6;

// Emailed codes follow the Supabase project's "Email OTP Length" setting (6-10), so the
// email-code inputs must not assume 6.
export const EMAIL_OTP_MIN_LENGTH = 6;
export const EMAIL_OTP_MAX_LENGTH = 10;

// Pasted codes often carry stray whitespace, a newline, or a label; maxLength on the
// input would truncate those before they could be cleaned, so sanitize here instead.
export function normalizeOtpInput(raw: string, maxLength: number = OTP_CODE_LENGTH): string {
  return raw.replace(/\D/g, '').slice(0, maxLength);
}
