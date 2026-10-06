export const OTP_CODE_LENGTH = 6;

// Pasted codes often carry stray whitespace, a newline, or a label; maxLength on the
// input would truncate those before they could be cleaned, so sanitize here instead.
export function normalizeOtpInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, OTP_CODE_LENGTH);
}
