import { describe, expect, it } from 'vitest';
import { mapAcFields } from '../fieldMap';
import type { RawAcContactPayload } from '../types';

function makePayload(overrides: Partial<RawAcContactPayload> = {}): RawAcContactPayload {
  return {
    contact: {
      id: '1',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '0438438438',
    },
    fieldValues: [],
    tags: [],
    listMembership: { contact: '1', list: '1', status: '1' },
    ...overrides,
  };
}

describe('mapAcFields', () => {
  it('maps standard contact fields (name, email, phone)', () => {
    const result = mapAcFields(makePayload());
    expect(result.fullName).toBe('Jane Doe');
    expect(result.email).toBe('jane@example.com');
    expect(result.phoneRaw).toBe('0438438438');
  });

  it('reads state from field [6] when populated', () => {
    const result = mapAcFields(
      makePayload({ fieldValues: [{ field: '6', value: 'NSW' }] })
    );
    expect(result.state).toBe('NSW');
  });

  it('falls back to field [25] AU State only when [6] is absent', () => {
    const result = mapAcFields(
      makePayload({ fieldValues: [{ field: '25', value: 'QLD' }] })
    );
    expect(result.state).toBe('QLD');
  });

  it('prefers field [6] over field [25] when both are present', () => {
    const result = mapAcFields(
      makePayload({
        fieldValues: [
          { field: '25', value: 'QLD' },
          { field: '6', value: 'NSW' },
        ],
      })
    );
    expect(result.state).toBe('NSW');
  });

  it('treats a blank field [6] value as absent and falls back to [25]', () => {
    const result = mapAcFields(
      makePayload({
        fieldValues: [
          { field: '6', value: '   ' },
          { field: '25', value: 'VIC' },
        ],
      })
    );
    expect(result.state).toBe('VIC');
  });

  it('returns null state when neither field is present', () => {
    const result = mapAcFields(makePayload({ fieldValues: [] }));
    expect(result.state).toBeNull();
  });

  it('never surfaces an excluded field even if present in the payload', () => {
    // Simulates a payload that (incorrectly, or via a future AC form change)
    // includes excluded custom fields alongside allowed ones — mapAcFields
    // must only ever read the whitelisted IDs.
    const result = mapAcFields(
      makePayload({
        fieldValues: [
          { field: '6', value: 'NSW' },
          { field: '15', value: 'Anglican' }, // [15] Denomination — excluded
          { field: '12', value: '$100' }, // [12] How much would you like to give? — excluded
        ],
      })
    ) as unknown as Record<string, unknown>;
    expect(Object.values(result)).not.toContain('Anglican');
    expect(Object.values(result)).not.toContain('$100');
  });

  it('returns null fullName when both name parts are blank', () => {
    const result = mapAcFields(
      makePayload({ contact: { id: '1', email: null, firstName: '  ', lastName: null, phone: null } })
    );
    expect(result.fullName).toBeNull();
    expect(result.email).toBeNull();
    expect(result.phoneRaw).toBeNull();
  });

  it('reads postcode from field [30] when populated', () => {
    const result = mapAcFields(makePayload({ fieldValues: [{ field: '30', value: '3080' }] }));
    expect(result.postcode).toBe('3080');
  });

  it('returns null postcode when field [30] is absent — expected for any registrant predating the field', () => {
    const result = mapAcFields(makePayload({ fieldValues: [] }));
    expect(result.postcode).toBeNull();
  });
});
