import { describe, it, expect } from 'vitest';
import {
  sanitizeCountInput,
  sanitizeNameInput,
  nameFieldCount,
  resizeNames,
  formatReportDate,
} from '../campaignReportEntry';

describe('sanitizeCountInput', () => {
  it('keeps digits only and caps at two', () => {
    expect(sanitizeCountInput('3')).toBe('3');
    expect(sanitizeCountInput('123')).toBe('12');
    expect(sanitizeCountInput('a1b2')).toBe('12');
    expect(sanitizeCountInput('-5.')).toBe('5');
    expect(sanitizeCountInput('')).toBe('');
  });
});

describe('sanitizeNameInput', () => {
  it('keeps letters and spaces only and caps at 20', () => {
    expect(sanitizeNameInput('Jo hn-Smith9!')).toBe('Jo hnSmith');
    expect(sanitizeNameInput('a'.repeat(30))).toHaveLength(20);
  });
});

describe('nameFieldCount', () => {
  it('maps a count string to a number of boxes', () => {
    expect(nameFieldCount('3')).toBe(3);
    expect(nameFieldCount('07')).toBe(7);
    expect(nameFieldCount('0')).toBe(0);
    expect(nameFieldCount('')).toBe(0);
  });
});

describe('resizeNames', () => {
  it('grows with blanks and shrinks keeping earlier entries', () => {
    expect(resizeNames(['a'], 3)).toEqual(['a', '', '']);
    expect(resizeNames(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
    expect(resizeNames(['a'], 0)).toEqual([]);
  });
});

describe('formatReportDate', () => {
  it('formats as dd/mm/yyyy', () => {
    expect(formatReportDate('2026-11-04')).toBe('04/11/2026');
  });
});
