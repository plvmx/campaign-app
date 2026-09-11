import { describe, it, expect } from 'vitest';
import {
  EDITABLE_REGISTRANT_FIELDS,
  EDITABLE_FIELD_COLUMNS,
  isEditableRegistrantField,
  isValidAustralianPostcode,
  isValidRegistrantState,
  isValidRegistrantFieldValue,
} from '../registrantValidation';

describe('isEditableRegistrantField', () => {
  it('accepts each of the four whitelisted fields', () => {
    for (const field of EDITABLE_REGISTRANT_FIELDS) {
      expect(isEditableRegistrantField(field)).toBe(true);
    }
  });

  it('rejects a field not on the whitelist, notably the identity keys', () => {
    expect(isEditableRegistrantField('email')).toBe(false);
    expect(isEditableRegistrantField('phone')).toBe(false);
    expect(isEditableRegistrantField('registeredAt')).toBe(false);
    expect(isEditableRegistrantField('id')).toBe(false);
  });
});

describe('EDITABLE_FIELD_COLUMNS', () => {
  it('maps every editable field to its real registry.registrants column', () => {
    expect(EDITABLE_FIELD_COLUMNS).toEqual({
      firstName: 'first_name',
      lastName: 'last_name',
      state: 'state',
      postcode: 'postcode',
    });
  });
});

describe('isValidAustralianPostcode', () => {
  it('accepts a plausible 4-digit postcode', () => {
    expect(isValidAustralianPostcode('3000')).toBe(true);
    expect(isValidAustralianPostcode('0800')).toBe(true);
  });

  it('rejects the wrong number of digits', () => {
    expect(isValidAustralianPostcode('300')).toBe(false);
    expect(isValidAustralianPostcode('30001')).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(isValidAustralianPostcode('30AB')).toBe(false);
    expect(isValidAustralianPostcode('NFC')).toBe(false);
  });

  it('allows null or blank — clearing the field is valid, postcode is optional', () => {
    expect(isValidAustralianPostcode(null)).toBe(true);
    expect(isValidAustralianPostcode('')).toBe(true);
    expect(isValidAustralianPostcode('   ')).toBe(true);
  });

  it('tolerates surrounding whitespace on an otherwise-valid value', () => {
    expect(isValidAustralianPostcode(' 3000 ')).toBe(true);
  });
});

describe('isValidRegistrantState', () => {
  it('accepts every real state code', () => {
    for (const code of ['ACT', 'NSW', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NT']) {
      expect(isValidRegistrantState(code)).toBe(true);
    }
  });

  it('rejects an unrecognized value — the dropdown should never send one, but the API must not trust that', () => {
    expect(isValidRegistrantState('XX')).toBe(false);
    expect(isValidRegistrantState('vic')).toBe(false); // lowercase — the dropdown sends canonical uppercase codes only
  });

  it('allows null or blank — clearing the state is valid', () => {
    expect(isValidRegistrantState(null)).toBe(true);
    expect(isValidRegistrantState('')).toBe(true);
  });
});

describe('isValidRegistrantFieldValue', () => {
  it('dispatches postcode values to isValidAustralianPostcode', () => {
    expect(isValidRegistrantFieldValue('postcode', '3000')).toBe(true);
    expect(isValidRegistrantFieldValue('postcode', 'bad')).toBe(false);
  });

  it('dispatches state values to isValidRegistrantState', () => {
    expect(isValidRegistrantFieldValue('state', 'NSW')).toBe(true);
    expect(isValidRegistrantFieldValue('state', 'bad')).toBe(false);
  });

  it('imposes no format constraint on name fields', () => {
    expect(isValidRegistrantFieldValue('firstName', "O'Malley-Smith")).toBe(true);
    expect(isValidRegistrantFieldValue('lastName', '')).toBe(true);
  });
});
