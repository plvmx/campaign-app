import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabaseClient', () => ({
  supabase: { from: vi.fn(), auth: {} },
}));

import { supabase } from '../supabaseClient';
import { makeQueryBuilder } from '../services/__tests__/supabaseMock';
import { getSharedWithMeOwners, canAccessCampaign, isCampaignOwner } from '../leaderShares';

const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getSharedWithMeOwners
// ---------------------------------------------------------------------------

describe('getSharedWithMeOwners', () => {
  it('returns [] without querying when myState is blank', async () => {
    expect(await getSharedWithMeOwners('', 'Alice')).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns [] without querying when myLeader is blank', async () => {
    expect(await getSharedWithMeOwners('VIC', '   ')).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('queries by uppercased/trimmed shared_with_state', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: [], error: null }));
    await getSharedWithMeOwners(' vic ', 'Alice');
    const builder = mockFrom.mock.results[0].value;
    expect(builder.eq).toHaveBeenCalledWith('shared_with_state', 'VIC');
  });

  it('filters rows to an exact normalized-name match on shared_with_leader', async () => {
    const rows = [
      { owner_state: 'NSW', owner_leader: 'Bob', shared_with_leader: 'Alice' },
      { owner_state: 'QLD', owner_leader: 'Carl', shared_with_leader: '  ALICE  ' }, // same person, different casing/whitespace
      { owner_state: 'WA', owner_leader: 'Dan', shared_with_leader: 'Alicia' }, // different person — must not match
    ];
    mockFrom.mockReturnValue(makeQueryBuilder({ data: rows, error: null }));
    const result = await getSharedWithMeOwners('VIC', 'Alice');
    expect(result).toEqual([
      { owner_state: 'NSW', owner_leader: 'Bob' },
      { owner_state: 'QLD', owner_leader: 'Carl' },
    ]);
  });

  it('returns [] (not a throw) on a query error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: { message: 'db down' } }));
    const result = await getSharedWithMeOwners('VIC', 'Alice');
    expect(result).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// canAccessCampaign
// ---------------------------------------------------------------------------

describe('canAccessCampaign', () => {
  it('returns false without querying when myState is blank', async () => {
    expect(await canAccessCampaign('VIC', 'Alice', null, '', 'Alice', null)).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns false without querying when myLeader is blank', async () => {
    expect(await canAccessCampaign('VIC', 'Alice', null, 'VIC', null, null)).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('grants access when state+leader match and neither side has a mobile on record', async () => {
    const result = await canAccessCampaign('VIC', 'Alice', null, 'VIC', 'Alice', null);
    expect(result).toBe(true);
    expect(mockFrom).not.toHaveBeenCalled(); // owner check short-circuits before the shared lookup
  });

  it('grants access when state+leader match and mobiles match', async () => {
    const result = await canAccessCampaign('VIC', 'Alice', '0412345678', 'VIC', 'Alice', '0412 345 678');
    expect(result).toBe(true);
  });

  it('denies access when state+leader match but both sides have a mobile on record and they differ', async () => {
    // Two different people who happen to share a name/state are distinguished by mobile —
    // this must NOT fall back to "owner by name alone" once both mobiles are present.
    mockFrom.mockReturnValue(makeQueryBuilder({ data: [], error: null })); // no shared-with-me rows either
    const result = await canAccessCampaign('VIC', 'Alice', '0412345678', 'VIC', 'Alice', '0499999999');
    expect(result).toBe(false);
  });

  it('grants access via a shared-with-me relationship even when not the owner', async () => {
    mockFrom.mockReturnValue(
      makeQueryBuilder({ data: [{ owner_state: 'NSW', owner_leader: 'Bob', shared_with_leader: 'Alice' }], error: null }),
    );
    const result = await canAccessCampaign('NSW', 'Bob', null, 'VIC', 'Alice', null);
    expect(result).toBe(true);
  });

  it('denies access when neither owner nor shared-with-me', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: [], error: null }));
    const result = await canAccessCampaign('NSW', 'Bob', null, 'VIC', 'Alice', null);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isCampaignOwner
// ---------------------------------------------------------------------------

describe('isCampaignOwner', () => {
  it('returns false when myLeader is blank', () => {
    expect(isCampaignOwner('Alice', null, '', null)).toBe(false);
  });

  it('returns false when the leader name does not match', () => {
    expect(isCampaignOwner('Bob', null, 'Alice', null)).toBe(false);
  });

  it('returns true on a leader-name match (case/whitespace-insensitive) when neither side has a mobile', () => {
    expect(isCampaignOwner('  ALICE  ', null, 'alice', null)).toBe(true);
  });

  it('returns true when the leader matches and mobiles match', () => {
    expect(isCampaignOwner('Alice', '0412345678', 'Alice', '0412 345 678')).toBe(true);
  });

  it('returns false when the leader matches but mobiles differ', () => {
    expect(isCampaignOwner('Alice', '0412345678', 'Alice', '0499999999')).toBe(false);
  });

  it('never treats two mobiles that both normalize to empty as a match', () => {
    // myMobile '+61' alone normalizes to '' (country code with nothing after it) — without the
    // explicit non-empty guard, this would false-positive-match a campaign with no mobile at all.
    expect(isCampaignOwner('Alice', '', 'Alice', '+61')).toBe(false);
  });
});
