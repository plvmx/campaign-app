import { describe, it, expect } from 'vitest';
import {
  DUPLICATE_EMAIL_MESSAGE,
  INVALID_EMAIL_MESSAGE,
  NO_RECIPIENTS_MESSAGE,
  hasRecipientFormErrors,
  parseRecipientList,
  serializeRecipients,
  validateRecipientForm,
  validateRecipientList,
} from '../campaignReportEmailSettings';

describe('parseRecipientList / serializeRecipients', () => {
  it('splits on commas, trims and drops blanks', () => {
    expect(parseRecipientList(' a@x.com , ,b@x.com ')).toEqual(['a@x.com', 'b@x.com']);
    expect(parseRecipientList(null)).toEqual([]);
    expect(parseRecipientList('')).toEqual([]);
  });

  it('round-trips', () => {
    expect(serializeRecipients(['a@x.com', ' b@x.com ', ''])).toBe('a@x.com, b@x.com');
  });
});

describe('validateRecipientList', () => {
  it('accepts up to four distinct valid addresses, and none', () => {
    expect(validateRecipientList([])).toBeNull();
    expect(validateRecipientList(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'])).toBeNull();
  });

  it('rejects more than four', () => {
    expect(validateRecipientList(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'])).toMatch(/No more than 4/);
  });

  it('rejects an invalid address and a case-insensitive repeat', () => {
    expect(validateRecipientList(['nope'])).toMatch(/not a valid email/);
    expect(validateRecipientList(['a@x.com', 'A@X.com'])).toMatch(/listed twice/);
    expect(validateRecipientList([`${'a'.repeat(250)}@x.com`])).toMatch(/not a valid email/);
  });
});

describe('validateRecipientForm', () => {
  it('passes a filled valid form and ignores blank boxes', () => {
    const errors = validateRecipientForm(['a@x.com', '', '  ', ''], true);
    expect(hasRecipientFormErrors(errors)).toBe(false);
  });

  it('flags an invalid box and a repeated box, by position', () => {
    const errors = validateRecipientForm(['a@x.com', 'bad', 'A@x.com', ''], false);
    expect(errors.fields).toEqual([undefined, INVALID_EMAIL_MESSAGE, DUPLICATE_EMAIL_MESSAGE, undefined]);
    expect(hasRecipientFormErrors(errors)).toBe(true);
  });

  it('needs at least one address only when sending is on', () => {
    expect(validateRecipientForm(['', '', '', ''], true).form).toBe(NO_RECIPIENTS_MESSAGE);
    expect(hasRecipientFormErrors(validateRecipientForm(['', '', '', ''], false))).toBe(false);
  });
});
