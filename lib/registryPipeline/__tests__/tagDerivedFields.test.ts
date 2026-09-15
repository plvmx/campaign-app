import { describe, expect, it } from 'vitest';
import { deriveTagFields, normalizeAcDate } from '../tagDerivedFields';

describe('deriveTagFields', () => {
  it('returns all null for a contact with no relevant tags', () => {
    expect(deriveTagFields([{ id: '21' }])).toEqual({
      webinarAttended: null,
      codeOfConductAgreed: null,
      codeOfConductAgreedAt: null,
    });
  });

  it('returns all null for a contact with no tags at all', () => {
    expect(deriveTagFields([])).toEqual({
      webinarAttended: null,
      codeOfConductAgreed: null,
      codeOfConductAgreedAt: null,
    });
  });

  it('derives webinarAttended = Yes from tag 60', () => {
    expect(deriveTagFields([{ id: '60' }]).webinarAttended).toBe('Yes');
  });

  it('derives webinarAttended = No from tag 56', () => {
    expect(deriveTagFields([{ id: '56' }]).webinarAttended).toBe('No');
  });

  it('prefers Attended (60) over Missed (56) if a contact somehow has both', () => {
    expect(deriveTagFields([{ id: '56' }, { id: '60' }]).webinarAttended).toBe('Yes');
  });

  it('derives codeOfConductAgreed = Yes from tag 48, never No', () => {
    const result = deriveTagFields([{ id: '48' }]);
    expect(result.codeOfConductAgreed).toBe('Yes');
  });

  it('derives codeOfConductAgreedAt from tag 48\'s own cdate', () => {
    const result = deriveTagFields([
      { id: '21', cdate: '2019-03-22T04:50:53-05:00' },
      { id: '48', cdate: '2021-11-05T18:31:54-05:00' },
    ]);
    expect(result.codeOfConductAgreedAt).toBe('2021-11-05T18:31:54-05:00');
  });

  it('leaves codeOfConductAgreedAt null when tag 48 is present but has no cdate (pre-capture staging payload)', () => {
    const result = deriveTagFields([{ id: '48' }]);
    expect(result.codeOfConductAgreed).toBe('Yes');
    expect(result.codeOfConductAgreedAt).toBeNull();
  });

  it('leaves codeOfConductAgreed/At null when tag 48 is absent', () => {
    const result = deriveTagFields([{ id: '60', cdate: '2021-06-24T04:31:15-05:00' }]);
    expect(result.codeOfConductAgreed).toBeNull();
    expect(result.codeOfConductAgreedAt).toBeNull();
  });
});

describe('normalizeAcDate', () => {
  it('accepts a bare AC date', () => {
    expect(normalizeAcDate('2021-06-16')).toBe('2021-06-16');
  });

  it('accepts an AC datetime with a timezone offset', () => {
    expect(normalizeAcDate('2021-06-22T09:30:00+10:00')).toBe('2021-06-22T09:30:00+10:00');
  });

  it('accepts an AC datetime with a Z suffix', () => {
    expect(normalizeAcDate('2021-06-22T09:30:00Z')).toBe('2021-06-22T09:30:00Z');
  });

  it('rejects a non-ISO value', () => {
    expect(normalizeAcDate('22/06/2021')).toBeNull();
  });

  it('rejects blank/whitespace', () => {
    expect(normalizeAcDate('  ')).toBeNull();
  });

  it('rejects null/undefined', () => {
    expect(normalizeAcDate(null)).toBeNull();
    expect(normalizeAcDate(undefined)).toBeNull();
  });
});
