import { describe, it, expect } from 'vitest';
import {
  sanitizeDonorNameInput,
  sanitizeDonationAmountInput,
  validateDonationNoticeForm,
  hasDonationNoticeFormErrors,
  DONOR_NAME_REQUIRED_MESSAGE,
  DONOR_EMAIL_INVALID_MESSAGE,
  DONOR_AMOUNT_INVALID_MESSAGE,
} from '../donationNotice';

describe('sanitizeDonorNameInput', () => {
  it('keeps letters, spaces, hyphens and apostrophes, trims to the max length', () => {
    expect(sanitizeDonorNameInput("Mary-Jane O'Brien 123!")).toBe("Mary-Jane O'Brien ");
    expect(sanitizeDonorNameInput('a'.repeat(150))).toHaveLength(100);
  });
});

describe('sanitizeDonationAmountInput', () => {
  it('keeps digits and at most one decimal point with two decimal places', () => {
    expect(sanitizeDonationAmountInput('$1,234.567')).toBe('1234.56');
    expect(sanitizeDonationAmountInput('12.3.4')).toBe('12.34');
    expect(sanitizeDonationAmountInput('1234567')).toBe('123456');
  });
});

describe('validateDonationNoticeForm', () => {
  it('requires a name but accepts a blank email and amount', () => {
    const errors = validateDonationNoticeForm({ name: '', email: '', amount: '' });
    expect(errors.name).toBe(DONOR_NAME_REQUIRED_MESSAGE);
    expect(errors.email).toBeUndefined();
    expect(errors.amount).toBeUndefined();
  });

  it('accepts a fully filled, valid form', () => {
    const errors = validateDonationNoticeForm({ name: 'Mary', email: 'mary@example.com', amount: '50.50' });
    expect(hasDonationNoticeFormErrors(errors)).toBe(false);
  });

  it('rejects an invalid email when one is provided', () => {
    expect(validateDonationNoticeForm({ name: 'Mary', email: 'nope', amount: '' }).email).toBe(DONOR_EMAIL_INVALID_MESSAGE);
  });

  it.each(['0', '-5', 'abc', '12.345'])('rejects an invalid amount %j when one is provided', (amount) => {
    expect(validateDonationNoticeForm({ name: 'Mary', email: '', amount }).amount).toBe(DONOR_AMOUNT_INVALID_MESSAGE);
  });

  it('accepts a valid whole or decimal amount', () => {
    for (const amount of ['50', '50.5', '999999.99']) {
      expect(validateDonationNoticeForm({ name: 'Mary', email: '', amount }).amount).toBeUndefined();
    }
  });
});
