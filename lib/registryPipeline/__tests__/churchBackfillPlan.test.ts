import { describe, it, expect } from 'vitest';
import { planChurchBackfill, type BlankChurchRegistrant } from '../churchBackfillPlan';
import type { RawAcContactPayload } from '../types';

// Synthetic people only — never put real registrants' details in a committed test.
function payload(fieldValues: { field: string; value: string }[]): RawAcContactPayload {
  return {
    contact: { id: 'c1', email: 'a@example.com', firstName: 'A', lastName: 'B', phone: null, cdate: '2026-09-01T00:00:00Z' },
    fieldValues,
    tags: [],
    listMembership: { list: '1', status: '1', contact: 'c1' },
  } as unknown as RawAcContactPayload;
}

const reg = (id: string, acContactId: string): BlankChurchRegistrant => ({ id, acContactId, email: `${id}@example.com` });

describe('planChurchBackfill', () => {
  it('fills the church from field [8], which the sync did not read before', () => {
    const plan = planChurchBackfill([reg('r1', 'c1')], new Map([['c1', payload([{ field: '8', value: 'St Example' }])]]));
    expect(plan).toEqual([{ registrantId: 'r1', acContactId: 'c1', email: 'r1@example.com', churchName: 'St Example' }]);
  });

  it('leaves out a registrant whose latest payload has no church', () => {
    const plan = planChurchBackfill([reg('r1', 'c1')], new Map([['c1', payload([{ field: '6', value: 'WA' }])]]));
    expect(plan).toEqual([]);
  });

  it('leaves out a registrant with no saved payload at all', () => {
    expect(planChurchBackfill([reg('r1', 'c9')], new Map())).toEqual([]);
  });

  it('plans each registrant from its own contact\'s payload', () => {
    const payloads = new Map([
      ['c1', payload([{ field: '26', value: 'First Church' }])],
      ['c2', payload([{ field: '8', value: 'Second Church' }])],
    ]);
    const plan = planChurchBackfill([reg('r1', 'c1'), reg('r2', 'c2')], payloads);
    expect(plan.map((p) => [p.registrantId, p.churchName])).toEqual([['r1', 'First Church'], ['r2', 'Second Church']]);
  });
});
