import { describe, it, expect, vi } from 'vitest';

// lib/auth pulls in the browser Supabase client, which needs env vars at import time.
vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: {}, from: vi.fn() } }));

import { canRecordResultsFor, type RecordResultsCaller } from '../recordResultsAccess';

const campaign = { state: 'VIC', leader: 'Jane Smith', mobile: '0400 123 456' };
const caller = (over: Partial<RecordResultsCaller> = {}): RecordResultsCaller => ({
  adminStatus: null, state: 'VIC', leader: 'Jane Smith', mobile: '0400123456', ...over,
});

describe('canRecordResultsFor', () => {
  it('lets a full admin record for any campaign', () => {
    expect(canRecordResultsFor({ ...campaign, state: 'WA' }, caller({ adminStatus: 'AD', state: 'VIC', leader: 'Someone Else' }), [])).toBe(true);
  });

  it('lets a state reporter record only in their own state (case-insensitive)', () => {
    expect(canRecordResultsFor(campaign, caller({ adminStatus: 'SR', leader: 'Other', mobile: null }), [])).toBe(true);
    expect(canRecordResultsFor(campaign, caller({ adminStatus: 'SR', state: 'vic', leader: 'Other' }), [])).toBe(true);
    expect(canRecordResultsFor({ ...campaign, state: 'NSW' }, caller({ adminStatus: 'SR' }), [])).toBe(false);
  });

  it('lets a plain leader record for their own campaign (name, state and mobile all match, however written)', () => {
    expect(canRecordResultsFor(campaign, caller(), [])).toBe(true);
    expect(canRecordResultsFor(campaign, caller({ leader: ' jane smith ', mobile: '+61 400 123 456' }), [])).toBe(true);
  });

  it.each<[string, Partial<RecordResultsCaller>]>([
    ['a different leader name', { leader: 'John Smith' }],
    ['a different mobile', { mobile: '0499999999' }],
    ['no mobile on file', { mobile: null }],
    ['no leader name', { leader: null }],
  ])('refuses a plain leader with %s', (_label, over) => {
    expect(canRecordResultsFor(campaign, caller(over), [])).toBe(false);
  });

  it('lets a leader record for their own campaign in another state than the row they signed in with (same name + mobile)', () => {
    // Mary Mc: an NSW admin row with no mobile, and an ACT row with her mobile.
    // She signs in on the ACT row but her campaign is NSW — the feed shows it
    // (matches by name + mobile), so the button must appear too.
    expect(canRecordResultsFor({ ...campaign, state: 'NSW' }, caller({ state: 'ACT' }), [])).toBe(true);
    expect(canRecordResultsFor({ ...campaign, state: 'NSW' }, caller({ state: null }), [])).toBe(true);
    expect(canRecordResultsFor({ ...campaign, state: 'NSW' }, caller({ state: 'ACT', mobile: '0499999999' }), [])).toBe(false);
  });

  it('lets a plain leader record for a campaign another leader shared with them, and only that one', () => {
    const other = caller({ leader: 'John Smith', mobile: '0411111111' });
    expect(canRecordResultsFor(campaign, other, [{ owner_state: 'VIC', owner_leader: 'jane smith' }])).toBe(true);
    expect(canRecordResultsFor(campaign, other, [{ owner_state: 'NSW', owner_leader: 'Jane Smith' }])).toBe(false);
    expect(canRecordResultsFor(campaign, other, [{ owner_state: 'VIC', owner_leader: 'Someone Else' }])).toBe(false);
  });
});
