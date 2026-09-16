import { describe, it, expect } from 'vitest';
import { protectExistingRegistrantName } from '../registrantNameGuard';

describe('protectExistingRegistrantName', () => {
  it('keeps the existing name instead of a later sync\'s placeholder test values (the Lorraine Walker incident)', () => {
    const candidate = { first_name: 'Test', last_name: 'Testing', state: 'WA' as string | null };
    const existing = { first_name: 'Lorraine', last_name: 'Walker' };

    const result = protectExistingRegistrantName(candidate, existing);

    expect(result.first_name).toBe('Lorraine');
    expect(result.last_name).toBe('Walker');
    expect(result.state).toBe('WA'); // untouched fields pass through unchanged
  });

  it('fills in a currently blank name from the new sync, rather than leaving it blank forever', () => {
    const candidate = { first_name: 'Jane', last_name: 'Doe' };
    const existing = { first_name: null, last_name: '' };

    const result = protectExistingRegistrantName(candidate, existing);

    expect(result.first_name).toBe('Jane');
    expect(result.last_name).toBe('Doe');
  });

  it('protects first and last name independently', () => {
    const candidate = { first_name: 'New', last_name: 'Value' };
    const existing = { first_name: 'Existing', last_name: null };

    const result = protectExistingRegistrantName(candidate, existing);

    expect(result.first_name).toBe('Existing'); // protected — already had a real value
    expect(result.last_name).toBe('Value'); // filled in — was blank
  });

  it('treats a whitespace-only existing value as blank, so it can still be filled in', () => {
    const candidate = { first_name: 'Jane', last_name: 'Doe' };
    const existing = { first_name: '   ', last_name: '' };

    const result = protectExistingRegistrantName(candidate, existing);

    expect(result.first_name).toBe('Jane');
    expect(result.last_name).toBe('Doe');
  });
});
