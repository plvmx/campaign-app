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
      cdate: '2026-01-15T10:00:00Z',
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
    expect(result.firstName).toBe('Jane');
    expect(result.lastName).toBe('Doe');
    expect(result.email).toBe('jane@example.com');
    expect(result.phoneRaw).toBe('0438438438');
  });

  it('maps registeredAt from contact.cdate', () => {
    const result = mapAcFields(makePayload());
    expect(result.registeredAt).toBe('2026-01-15T10:00:00Z');
  });

  it('reads interestedInTraining from field [9] when populated', () => {
    const result = mapAcFields(makePayload({ fieldValues: [{ field: '9', value: 'Yes' }] }));
    expect(result.interestedInTraining).toBe('Yes');
  });

  it('returns null interestedInTraining when field [9] is absent', () => {
    const result = mapAcFields(makePayload({ fieldValues: [] }));
    expect(result.interestedInTraining).toBeNull();
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

  it('returns null firstName/lastName when both name parts are blank', () => {
    const result = mapAcFields(
      makePayload({ contact: { id: '1', email: null, firstName: '  ', lastName: null, phone: null, cdate: null } })
    );
    expect(result.firstName).toBeNull();
    expect(result.lastName).toBeNull();
    expect(result.email).toBeNull();
    expect(result.phoneRaw).toBeNull();
    expect(result.registeredAt).toBeNull();
  });

  it('reads postcode from field [30] when populated', () => {
    const result = mapAcFields(makePayload({ fieldValues: [{ field: '30', value: '3080' }] }));
    expect(result.postcode).toBe('3080');
  });

  it('returns null postcode when field [30] is absent — expected for any registrant predating the field', () => {
    const result = mapAcFields(makePayload({ fieldValues: [] }));
    expect(result.postcode).toBeNull();
  });

  it('reads churchLeader from field [28] when populated', () => {
    const result = mapAcFields(makePayload({ fieldValues: [{ field: '28', value: 'Yes' }] }));
    expect(result.churchLeader).toBe('Yes');
  });

  it('falls back to field [10] Church Leader? only when [28] is absent', () => {
    const result = mapAcFields(makePayload({ fieldValues: [{ field: '10', value: 'No' }] }));
    expect(result.churchLeader).toBe('No');
  });

  it('prefers field [28] over field [10] when both are present', () => {
    const result = mapAcFields(
      makePayload({ fieldValues: [{ field: '10', value: 'No' }, { field: '28', value: 'Yes' }] })
    );
    expect(result.churchLeader).toBe('Yes');
  });

  it('returns null churchLeader when neither field is present', () => {
    const result = mapAcFields(makePayload({ fieldValues: [] }));
    expect(result.churchLeader).toBeNull();
  });

  it('reads churchName from field [26] when populated', () => {
    const result = mapAcFields(makePayload({ fieldValues: [{ field: '26', value: 'Eaton Baptist Church' }] }));
    expect(result.churchName).toBe('Eaton Baptist Church');
  });

  it('falls back to field [14] Church Name only when [26] is absent', () => {
    const result = mapAcFields(makePayload({ fieldValues: [{ field: '14', value: 'Lifesource' }] }));
    expect(result.churchName).toBe('Lifesource');
  });

  it('returns null churchName when neither field is present', () => {
    const result = mapAcFields(makePayload({ fieldValues: [] }));
    expect(result.churchName).toBeNull();
  });
});
