/**
 * Input rules for the optional "let us know you're transferring" notice on
 * /public/donate (POST /api/public/donate) — a lightweight lead-capture kept
 * only for bank-transfer donors, since a card donation through Donorbox
 * already captures the donor's own details there. Pure, so the rules are
 * unit tested without any network.
 */
import { isValidEmail } from './emailFormat';

export const DONOR_NAME_MAX_LENGTH = 100;
export const DONOR_EMAIL_MAX_LENGTH = 200;
/** Digits only, up to 6 before the decimal point and 2 after (e.g. "999999.99"). */
export const DONOR_AMOUNT_MAX_LENGTH = 9;

/** Keeps letters, spaces, hyphens and apostrophes only, at most DONOR_NAME_MAX_LENGTH characters. */
export function sanitizeDonorNameInput(raw: string): string {
  return raw.replace(/[^A-Za-z '-]/g, '').slice(0, DONOR_NAME_MAX_LENGTH);
}

/** Keeps digits and at most one decimal point (max 2 decimal places, 6 digits before it). */
export function sanitizeDonationAmountInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  const withOneDot = firstDot === -1
    ? cleaned
    : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
  const [intPart, decPart] = withOneDot.split('.');
  const trimmedInt = intPart.slice(0, 6);
  return decPart === undefined ? trimmedInt : `${trimmedInt}.${decPart.slice(0, 2)}`;
}

export interface DonationNoticeFormErrors {
  name?: string;
  email?: string;
  amount?: string;
}

export const DONOR_NAME_REQUIRED_MESSAGE = 'Please enter your name.';
export const DONOR_EMAIL_INVALID_MESSAGE = 'Please enter a valid email address, or leave it blank.';
export const DONOR_AMOUNT_INVALID_MESSAGE = 'Please enter a valid amount greater than zero, or leave it blank.';

/**
 * Name is required (this is the one field a bank statement alone can't
 * supply); email and amount are each optional, but checked for a sensible
 * shape when filled in.
 */
export function validateDonationNoticeForm(input: { name: string; email: string; amount: string }): DonationNoticeFormErrors {
  const errors: DonationNoticeFormErrors = {};
  if (!input.name.trim()) errors.name = DONOR_NAME_REQUIRED_MESSAGE;

  const email = input.email.trim();
  if (email && !isValidEmail(email)) errors.email = DONOR_EMAIL_INVALID_MESSAGE;

  const amount = input.amount.trim();
  if (amount && (!/^\d{1,6}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0)) {
    errors.amount = DONOR_AMOUNT_INVALID_MESSAGE;
  }

  return errors;
}

export function hasDonationNoticeFormErrors(errors: DonationNoticeFormErrors): boolean {
  return !!(errors.name || errors.email || errors.amount);
}
