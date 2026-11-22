import { describe, it, expect } from 'vitest';
import {
  getLookupOptions,
  matchesLookupFilters,
  filterByLookups,
  LOOKUP_FIELDS,
  LOOKUP_FIELD_LABELS,
  BLANK_VALUE_OPTION,
  type LookupableRegistrant,
} from '../registrantLookupFilters';

function record(overrides: Partial<LookupableRegistrant> = {}): LookupableRegistrant {
  return { firstName: 'Vicky', lastName: 'Vale', email: 'vicky@example.com', phone: '+61400000001', postcode: '3000', churchName: 'Grace Church', webinarAttended: 'Yes', codeOfConductAgreed: null, ...overrides };
}

describe('LOOKUP_FIELDS / LOOKUP_FIELD_LABELS', () => {
  it('covers the pane\'s text columns other than State and the dates', () => {
    expect(LOOKUP_FIELDS).toEqual(['firstName', 'lastName', 'email', 'phone', 'postcode', 'churchName', 'webinarAttended', 'codeOfConductAgreed']);
  });

  it('labels phone as "Mobile", matching the pane\'s own column header', () => {
    expect(LOOKUP_FIELD_LABELS.phone).toBe('Mobile');
  });

  it('has a label for every field', () => {
    for (const field of LOOKUP_FIELDS) {
      expect(LOOKUP_FIELD_LABELS[field]).toBeTruthy();
    }
  });
});

describe('getLookupOptions', () => {
  const records = [
    record({ postcode: '3000' }),
    record({ email: 'nat@example.com', postcode: '2000' }),
    record({ email: 'nat@example.com', postcode: null }), // duplicate email, blank postcode
  ];

  it('returns every distinct non-blank value, sorted', () => {
    const values = getLookupOptions(records, 'postcode').map((o) => o.value).filter((v) => v !== BLANK_VALUE_OPTION);
    expect(values).toEqual(['2000', '3000']);
  });

  it('dedupes repeated values', () => {
    expect(getLookupOptions(records, 'email').map((o) => o.value)).toEqual(['nat@example.com', 'vicky@example.com']);
  });

  it('prepends a "(blank)" option only when at least one record actually has a blank value for that field', () => {
    const postcodeOptions = getLookupOptions(records, 'postcode');
    expect(postcodeOptions[0]).toEqual({ value: BLANK_VALUE_OPTION, label: '(blank)' });

    const emailOptions = getLookupOptions(records, 'email'); // no blank emails in the sample
    expect(emailOptions.some((o) => o.value === BLANK_VALUE_OPTION)).toBe(false);
  });

  it('treats an empty-string value the same as null for blank detection', () => {
    const options = getLookupOptions([record({ lastName: '' })], 'lastName');
    expect(options).toEqual([{ value: BLANK_VALUE_OPTION, label: '(blank)' }]);
  });

  it('returns no options for an empty record list', () => {
    expect(getLookupOptions([], 'firstName')).toEqual([]);
  });
});

describe('church / webinar / code lookups', () => {
  const records = [
    record({ churchName: 'Grace Church', webinarAttended: 'Yes', codeOfConductAgreed: 'Yes' }),
    record({ churchName: 'Hope Chapel', webinarAttended: null, codeOfConductAgreed: null }),
    record({ churchName: null, webinarAttended: 'Yes', codeOfConductAgreed: null }),
  ];

  it('lists the distinct church names, with (blank) when some are missing', () => {
    expect(getLookupOptions(records, 'churchName').map((o) => o.value)).toEqual([BLANK_VALUE_OPTION, 'Grace Church', 'Hope Chapel']);
  });

  it('finds everyone who agreed to the Code (or has not)', () => {
    expect(filterByLookups(records, { codeOfConductAgreed: 'Yes' })).toHaveLength(1);
    expect(filterByLookups(records, { codeOfConductAgreed: BLANK_VALUE_OPTION })).toHaveLength(2);
  });

  it('combines webinar attended with the Code', () => {
    expect(filterByLookups(records, { webinarAttended: 'Yes', codeOfConductAgreed: BLANK_VALUE_OPTION })).toHaveLength(1);
  });
});

describe('matchesLookupFilters', () => {
  const vicky = record();

  it('matches everything when no filters are set', () => {
    expect(matchesLookupFilters(vicky, {})).toBe(true);
  });

  it('matches on a single exact field value', () => {
    expect(matchesLookupFilters(vicky, { postcode: '3000' })).toBe(true);
    expect(matchesLookupFilters(vicky, { postcode: '2000' })).toBe(false);
  });

  it('combines multiple active filters with AND', () => {
    expect(matchesLookupFilters(vicky, { firstName: 'Vicky', postcode: '3000' })).toBe(true);
    expect(matchesLookupFilters(vicky, { firstName: 'Vicky', postcode: '2000' })).toBe(false);
  });

  it('the BLANK_VALUE_OPTION sentinel matches null or an empty string, nothing else', () => {
    expect(matchesLookupFilters(record({ lastName: null }), { lastName: BLANK_VALUE_OPTION })).toBe(true);
    expect(matchesLookupFilters(record({ lastName: '' }), { lastName: BLANK_VALUE_OPTION })).toBe(true);
    expect(matchesLookupFilters(record({ lastName: 'Vale' }), { lastName: BLANK_VALUE_OPTION })).toBe(false);
  });
});

describe('filterByLookups', () => {
  const records = [
    record({ firstName: 'Vicky', postcode: '3000' }),
    record({ firstName: 'Nat', postcode: '2000' }),
    record({ firstName: 'Vicky', postcode: '2000' }),
  ];

  it('returns only the records matching every active filter', () => {
    expect(filterByLookups(records, { firstName: 'Vicky' })).toHaveLength(2);
    expect(filterByLookups(records, { firstName: 'Vicky', postcode: '2000' })).toHaveLength(1);
  });

  it('returns every record when filters is empty', () => {
    expect(filterByLookups(records, {})).toHaveLength(3);
  });

  it('returns the caller\'s own row objects unmodified', () => {
    const result = filterByLookups(records, { firstName: 'Nat' });
    expect(result[0]).toBe(records[1]);
  });
});
