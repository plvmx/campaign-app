import { describe, it, expect } from 'vitest';
import type { ManageRegistrant } from '../manageSummaryTypes';
import { sortRegistrants, getPageCount, getPageSlice } from '../registrantSort';

function reg(id: string, overrides: Partial<ManageRegistrant> = {}): ManageRegistrant {
  return {
    id, firstName: null, lastName: null, email: null, phone: null, state: null, postcode: null,
    registeredAt: null, isLeader: false, leaderName: null, webinarSessionAt: null, webinarAttended: null,
    codeOfConductAgreed: null, codeOfConductAgreedAt: null, unsubscribed: null, nfc: null,
    ...overrides,
  };
}

const ids = (rs: ManageRegistrant[]) => rs.map((r) => r.id);

describe('sortRegistrants', () => {
  const rows = [
    reg('blank'),
    reg('tas', { postcode: '7000' }),
    reg('vic', { postcode: '3000' }),
    reg('nsw', { postcode: '2000' }),
  ];

  it('puts blanks last when ascending', () => {
    expect(ids(sortRegistrants(rows, 'postcode', 'asc'))).toEqual(['nsw', 'vic', 'tas', 'blank']);
  });

  it('also puts blanks last when descending', () => {
    expect(ids(sortRegistrants(rows, 'postcode', 'desc'))).toEqual(['tas', 'vic', 'nsw', 'blank']);
  });

  it('treats whitespace-only values as blank', () => {
    const out = sortRegistrants([reg('ws', { email: '  ' }), reg('a', { email: 'a@x.com' })], 'email', 'asc');
    expect(ids(out)).toEqual(['a', 'ws']);
  });

  it('compares text case-insensitively', () => {
    const out = sortRegistrants([reg('b', { email: 'Bob@x.com' }), reg('a', { email: 'alice@x.com' })], 'email', 'asc');
    expect(ids(out)).toEqual(['a', 'b']);
  });

  it('compares date columns as instants', () => {
    const out = sortRegistrants(
      [
        reg('late', { registeredAt: '2026-01-02T00:00:00+11:00' }),
        reg('early', { registeredAt: '2026-01-01T12:00:00Z' }),
      ],
      'registeredAt',
      'asc',
    );
    // 2026-01-02 00:00 +11:00 is 2026-01-01 13:00Z, i.e. after 12:00Z.
    expect(ids(out)).toEqual(['early', 'late']);
  });

  it('groups "Yes" rows together on a flag column', () => {
    const out = sortRegistrants(
      [reg('n'), reg('y1', { codeOfConductAgreed: 'Yes' }), reg('y2', { codeOfConductAgreed: 'Yes' })],
      'codeOfConductAgreed',
      'asc',
    );
    expect(ids(out)).toEqual(['y1', 'y2', 'n']);
  });

  it('does not mutate its input', () => {
    const copy = [...rows];
    sortRegistrants(rows, 'postcode', 'asc');
    expect(rows).toEqual(copy);
  });
});

describe('paging', () => {
  const items = Array.from({ length: 1234 }, (_, i) => i);

  it('counts pages, minimum one', () => {
    expect(getPageCount(0, 100)).toBe(1);
    expect(getPageCount(1234, 100)).toBe(13);
    expect(getPageCount(1234, 'all')).toBe(1);
  });

  it('reaches rows beyond the old 500-row cap', () => {
    expect(getPageSlice(items, 13, 100)).toEqual(items.slice(1200));
    expect(getPageSlice(items, 6, 100)[0]).toBe(500);
  });

  it('clamps an out-of-range page', () => {
    expect(getPageSlice(items, 99, 100)).toEqual(items.slice(1200));
    expect(getPageSlice(items, 0, 100)[0]).toBe(0);
  });

  it('returns everything for "all"', () => {
    expect(getPageSlice(items, 1, 'all')).toHaveLength(1234);
  });
});
