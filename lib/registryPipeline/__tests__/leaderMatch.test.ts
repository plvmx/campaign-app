import { describe, it, expect } from 'vitest';
import { buildLeaderPhoneIndex, findMatchingLeader, matchRegistrantsToLeaders, type LeaderForMatch } from '../leaderMatch';

const VICKY_LEADER: LeaderForMatch = { leader: 'Vicky Vale', mobile: '0400000001' };
const NAT_LEADER: LeaderForMatch = { leader: 'Nat Nelson', mobile: '0400000002' };

describe('buildLeaderPhoneIndex', () => {
  it('normalizes each leader\'s local-format mobile into the index key', () => {
    const index = buildLeaderPhoneIndex([VICKY_LEADER]);
    expect(index.get('+61400000001')).toEqual(VICKY_LEADER);
  });

  it('skips a leader with no mobile on file, rather than throwing', () => {
    const index = buildLeaderPhoneIndex([{ leader: 'No Phone', mobile: null }]);
    expect(index.size).toBe(0);
  });

  it('the later leader wins if two rows somehow share a phone', () => {
    const dupe: LeaderForMatch = { leader: 'Duplicate', mobile: VICKY_LEADER.mobile };
    const index = buildLeaderPhoneIndex([VICKY_LEADER, dupe]);
    expect(index.get('+61400000001')).toEqual(dupe);
  });
});

describe('findMatchingLeader', () => {
  const index = buildLeaderPhoneIndex([VICKY_LEADER, NAT_LEADER]);

  it('matches a registrant phone already in E.164 against a local-format leader mobile', () => {
    expect(findMatchingLeader('+61400000001', index)).toEqual({ leaderName: 'Vicky Vale' });
  });

  it('returns null for a phone with no matching leader', () => {
    expect(findMatchingLeader('+61499999999', index)).toBeNull();
  });

  it('returns null for a null/empty registrant phone', () => {
    expect(findMatchingLeader(null, index)).toBeNull();
  });
});

describe('matchRegistrantsToLeaders', () => {
  it('tags each registrant with whether it matched a leader, by phone', () => {
    const registrants = [
      { id: 'r1', phone: '+61400000001' }, // matches Vicky
      { id: 'r2', phone: '+61400000099' }, // no match
      { id: 'r3', phone: null }, // no phone at all
    ];
    const result = matchRegistrantsToLeaders(registrants, [VICKY_LEADER, NAT_LEADER]);

    expect(result[0]).toMatchObject({ id: 'r1', isLeader: true, leaderName: 'Vicky Vale' });
    expect(result[1]).toMatchObject({ id: 'r2', isLeader: false, leaderName: null });
    expect(result[2]).toMatchObject({ id: 'r3', isLeader: false, leaderName: null });
  });

  it('preserves every other field already on the registrant', () => {
    const registrants = [{ id: 'r1', phone: '+61400000001', email: 'vicky@example.com' }];
    const result = matchRegistrantsToLeaders(registrants, [VICKY_LEADER]);
    expect(result[0].email).toBe('vicky@example.com');
  });

  it('returns everyone unmatched when there are no leaders at all', () => {
    const registrants = [{ id: 'r1', phone: '+61400000001' }];
    expect(matchRegistrantsToLeaders(registrants, [])).toEqual([
      { id: 'r1', phone: '+61400000001', isLeader: false, leaderName: null },
    ]);
  });
});
