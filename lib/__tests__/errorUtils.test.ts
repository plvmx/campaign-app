import { describe, it, expect } from 'vitest';
import { getErrorMessage } from '../errorUtils';

// Regression coverage for #69: a state reporter's Team Member results were
// silently dropped by a DB check constraint, and the real Postgres error was
// swallowed because PostgrestError is a plain object, not `instanceof Error`.
// getErrorMessage must extract message/code/details/hint from that shape
// instead of falling back to the generic "unexpected error" string.
describe('getErrorMessage', () => {
  it('returns the message of a native Error', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns a plain string unchanged', () => {
    expect(getErrorMessage('something went wrong')).toBe('something went wrong');
  });

  it('extracts fields from a PostgrestError-shaped object (the #69 case)', () => {
    const postgrestError = {
      message: 'new row violates check constraint "results_category_code_check"',
      code: '23514',
      details: 'Failing row contains (..., TM).',
      hint: null,
    };
    expect(getErrorMessage(postgrestError)).toBe(
      'new row violates check constraint "results_category_code_check" | code: 23514 | details: Failing row contains (..., TM).'
    );
  });

  it('extracts only the fields that are present', () => {
    expect(getErrorMessage({ message: 'denied', code: '42501' })).toBe('denied | code: 42501');
  });

  it('extracts code alone when message is missing', () => {
    expect(getErrorMessage({ code: '23505' })).toBe('code: 23505');
  });

  it('falls back to the default message for null', () => {
    expect(getErrorMessage(null)).toBe('An unexpected error occurred');
  });

  it('falls back to the default message for undefined', () => {
    expect(getErrorMessage(undefined)).toBe('An unexpected error occurred');
  });

  it('falls back to a custom fallback message when provided', () => {
    expect(getErrorMessage(null, 'Failed to save')).toBe('Failed to save');
  });

  it('falls back for an object with no usable string fields', () => {
    expect(getErrorMessage({ message: 42, code: null })).toBe('An unexpected error occurred');
  });
});
