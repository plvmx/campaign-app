/**
 * Settings for the management email sent when a bank-transfer donor uses
 * the optional notice on /public/donate (see
 * lib/services/donationNoticeEmailService.ts). Stored in app_settings: an
 * on/off flag and a comma-separated recipient list.
 *
 * Deliberately mirrors lib/campaignReportEmailSettings.ts field-for-field —
 * noted as a follow-up in this PR's description rather than extracted into
 * a shared helper now, to keep this change scoped to the donations page.
 */
import { isValidEmail } from './emailFormat';

export const DONATION_NOTICE_EMAIL_ENABLED_KEY = 'donation_notice_email_enabled';
export const DONATION_NOTICE_EMAIL_RECIPIENTS_KEY = 'donation_notice_email_recipients';
export const MAX_DONATION_NOTICE_EMAIL_RECIPIENTS = 4;
const MAX_EMAIL_LENGTH = 254;

export const INVALID_EMAIL_MESSAGE = 'Enter a valid email address.';
export const DUPLICATE_EMAIL_MESSAGE = 'This address is already listed.';
export const NO_RECIPIENTS_MESSAGE = 'Add at least one email address before switching sending on.';

/** Stored value ("a@x.com, b@y.com") -> trimmed, non-empty addresses. */
export function parseRecipientList(raw: string | null | undefined): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function serializeRecipients(list: string[]): string {
  return list.map((s) => s.trim()).filter(Boolean).join(', ');
}

function isAcceptableEmail(value: string): boolean {
  return value.length <= MAX_EMAIL_LENGTH && isValidEmail(value);
}

/**
 * Server-side check of a recipient list: at most four, each a plausible
 * address, no repeats (case-insensitive). Returns an error message or null.
 */
export function validateRecipientList(list: string[]): string | null {
  if (list.length > MAX_DONATION_NOTICE_EMAIL_RECIPIENTS) {
    return `No more than ${MAX_DONATION_NOTICE_EMAIL_RECIPIENTS} email addresses are allowed.`;
  }
  const seen = new Set<string>();
  for (const address of list) {
    if (!isAcceptableEmail(address)) return `"${address}" is not a valid email address.`;
    const key = address.toLowerCase();
    if (seen.has(key)) return `"${address}" is listed twice.`;
    seen.add(key);
  }
  return null;
}

export interface RecipientFormErrors {
  /** One entry per input box; undefined means that box is fine. */
  fields: (string | undefined)[];
  /** A problem with the form as a whole (e.g. sending on, nobody listed). */
  form?: string;
}

/** Form-level check for the admin card's input boxes. Blank boxes are ignored. */
export function validateRecipientForm(inputs: string[], enabled: boolean): RecipientFormErrors {
  const seen = new Set<string>();
  let filled = 0;
  const fields = inputs.map((raw) => {
    const value = raw.trim();
    if (!value) return undefined;
    filled++;
    if (!isAcceptableEmail(value)) return INVALID_EMAIL_MESSAGE;
    const key = value.toLowerCase();
    if (seen.has(key)) return DUPLICATE_EMAIL_MESSAGE;
    seen.add(key);
    return undefined;
  });
  return { fields, form: enabled && filled === 0 ? NO_RECIPIENTS_MESSAGE : undefined };
}

export function hasRecipientFormErrors(errors: RecipientFormErrors): boolean {
  return !!errors.form || errors.fields.some(Boolean);
}
