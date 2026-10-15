import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: {}, from: vi.fn() } }));

import {
  matchesStateLeaderRoleFilter,
  STATE_LEADER_ROLE_FILTER_OPTIONS,
} from '@/lib/stateLeaderRoleFilter';

describe('matchesStateLeaderRoleFilter', () => {
  const values = ['AD', 'SR', null, undefined, '', 'x', 'ad'];

  it('shows everyone when no role is chosen', () => {
    for (const v of values) expect(matchesStateLeaderRoleFilter(v, '')).toBe(true);
  });

  it("'admins' keeps exactly AD and SR", () => {
    expect(values.filter(v => matchesStateLeaderRoleFilter(v, 'admins'))).toEqual(['AD', 'SR']);
  });

  it('AD / SR keep only that role', () => {
    expect(values.filter(v => matchesStateLeaderRoleFilter(v, 'AD'))).toEqual(['AD']);
    expect(values.filter(v => matchesStateLeaderRoleFilter(v, 'SR'))).toEqual(['SR']);
  });

  it("'leader' keeps everyone without a recognised admin role, including junk values", () => {
    expect(values.filter(v => matchesStateLeaderRoleFilter(v, 'leader'))).toEqual([null, undefined, '', 'x', 'ad']);
  });

  it('offers a label for every filter value', () => {
    expect(STATE_LEADER_ROLE_FILTER_OPTIONS.map(o => o.value)).toEqual(['', 'admins', 'AD', 'SR', 'leader']);
  });
});
