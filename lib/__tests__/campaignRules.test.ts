import { describe, it, expect } from 'vitest';
import { evaluateRule, evaluateRules } from '../campaignRules';
import type { CampaignRule } from '../campaignRules';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<CampaignRule> = {}): CampaignRule {
  return {
    id: 'test-rule',
    name: 'Test Rule',
    leader: 'Alice',
    state: 'VIC',
    place: 'Melbourne',
    time: '10:00',
    mobile: null,
    frequency_type: 'weekly',
    frequency_value: null,
    month_week_number: null,
    month_day_of_week: null,
    day_of_week: 6, // Saturday
    start_date: null,
    end_date: null,
    is_active: true,
    priority: 0,
    rule_config: {},
    notes: null,
    ...overrides,
  };
}

/** Parse a YYYY-MM-DD string as local midnight (avoids UTC shift). */
function local(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}

// ---------------------------------------------------------------------------
// Weekly rules
// ---------------------------------------------------------------------------

describe('weekly rules', () => {
  it('generates every Saturday within a fortnight', () => {
    const rule = makeRule({ day_of_week: 6 }); // Saturday
    const start = local('2025-06-02'); // Monday
    const end   = local('2025-06-15'); // Sunday (2 weeks)
    const results = evaluateRule(rule, start, end);
    expect(results.map(r => r.date)).toEqual(['2025-06-07', '2025-06-14']);
  });

  it('respects start_date boundary (inclusive)', () => {
    const rule = makeRule({
      day_of_week: 6,
      start_date: '2025-06-07',
    });
    const start = local('2025-06-02');
    const end   = local('2025-06-15');
    const results = evaluateRule(rule, start, end);
    expect(results.map(r => r.date)).toEqual(['2025-06-07', '2025-06-14']);
  });

  it('excludes campaigns before start_date — timezone fix: local not UTC', () => {
    // The date boundary is 2025-06-07. The first Saturday is also 2025-06-07.
    // Before the fix, new Date("2025-06-07") parsed as UTC midnight which is
    // 10 h ahead of AEST local midnight, causing the boundary check to reject
    // a campaign that should be included.
    const rule = makeRule({
      day_of_week: 6,
      start_date: '2025-06-07',
    });
    const start = local('2025-06-07');
    const end   = local('2025-06-07');
    const results = evaluateRule(rule, start, end);
    expect(results.map(r => r.date)).toEqual(['2025-06-07']);
  });

  it('respects end_date boundary (inclusive)', () => {
    const rule = makeRule({
      day_of_week: 6,
      end_date: '2025-06-07',
    });
    const start = local('2025-06-01');
    const end   = local('2025-06-15');
    const results = evaluateRule(rule, start, end);
    expect(results.map(r => r.date)).toEqual(['2025-06-07']);
  });

  it('returns empty when rule is inactive', () => {
    const rule = makeRule({ is_active: false });
    const results = evaluateRule(rule, local('2025-06-02'), local('2025-06-15'));
    expect(results).toHaveLength(0);
  });

  it('skips exception dates', () => {
    const rule = makeRule({
      day_of_week: 6,
      rule_config: { exceptions: ['2025-06-07'] },
    });
    const results = evaluateRule(rule, local('2025-06-02'), local('2025-06-15'));
    expect(results.map(r => r.date)).toEqual(['2025-06-14']);
  });
});

// ---------------------------------------------------------------------------
// Monthly rules — the critical algorithm fix
// ---------------------------------------------------------------------------

describe('monthly rules', () => {
  it('generates the 1st Monday of a month starting on Wednesday (regression: was returning null)', () => {
    // January 2025 starts on Wednesday (day 3). Under the old algorithm,
    // "1st week Monday" computed weekStart = Dec 29 → targetDate = Dec 30
    // → month check failed → null. Correct answer is Jan 6.
    const rule = makeRule({
      frequency_type: 'monthly',
      month_week_number: 1,
      month_day_of_week: 1, // Monday
      day_of_week: null,
    });
    const start = local('2025-01-01');
    const end   = local('2025-01-31');
    const results = evaluateRule(rule, start, end);
    expect(results.map(r => r.date)).toEqual(['2025-01-06']);
  });

  it('generates the 2nd Saturday of a month', () => {
    // January 2025: first Saturday is Jan 4, second is Jan 11.
    const rule = makeRule({
      frequency_type: 'monthly',
      month_week_number: 2,
      month_day_of_week: 6, // Saturday
      day_of_week: null,
    });
    const start = local('2025-01-01');
    const end   = local('2025-01-31');
    const results = evaluateRule(rule, start, end);
    expect(results.map(r => r.date)).toEqual(['2025-01-11']);
  });

  it('generates the last Saturday of a month', () => {
    // January 2025: last day is Jan 31 (Friday). Last Saturday is Jan 25.
    const rule = makeRule({
      frequency_type: 'monthly',
      month_week_number: -1,
      month_day_of_week: 6, // Saturday
      day_of_week: null,
    });
    const start = local('2025-01-01');
    const end   = local('2025-01-31');
    const results = evaluateRule(rule, start, end);
    expect(results.map(r => r.date)).toEqual(['2025-01-25']);
  });

  it('spans multiple months and finds each month\'s occurrence', () => {
    const rule = makeRule({
      frequency_type: 'monthly',
      month_week_number: 1,
      month_day_of_week: 6, // First Saturday
      day_of_week: null,
    });
    const start = local('2025-01-01');
    const end   = local('2025-03-31');
    const results = evaluateRule(rule, start, end);
    // First Saturdays: Jan 4, Feb 1, Mar 1
    expect(results.map(r => r.date)).toEqual(['2025-01-04', '2025-02-01', '2025-03-01']);
  });

  it('returns empty when month_week_number is null', () => {
    const rule = makeRule({
      frequency_type: 'monthly',
      month_week_number: null,
      month_day_of_week: 6,
      day_of_week: null,
    });
    const results = evaluateRule(rule, local('2025-01-01'), local('2025-01-31'));
    expect(results).toHaveLength(0);
  });

  it('returns empty when month_day_of_week is null', () => {
    const rule = makeRule({
      frequency_type: 'monthly',
      month_week_number: 1,
      month_day_of_week: null,
      day_of_week: null,
    });
    const results = evaluateRule(rule, local('2025-01-01'), local('2025-01-31'));
    expect(results).toHaveLength(0);
  });

  it('handles the 4th occurrence when only 4 exist in the month', () => {
    // January 2025 has 5 Saturdays (4, 11, 18, 25 and Feb 1 is outside).
    // 4th Saturday = Jan 25.
    const rule = makeRule({
      frequency_type: 'monthly',
      month_week_number: 4,
      month_day_of_week: 6,
      day_of_week: null,
    });
    const results = evaluateRule(rule, local('2025-01-01'), local('2025-01-31'));
    expect(results.map(r => r.date)).toEqual(['2025-01-25']);
  });
});

// ---------------------------------------------------------------------------
// Biweekly rules — multi-result fix
// ---------------------------------------------------------------------------

describe('biweekly rules', () => {
  it('generates every 2 weeks within a range (regression: was returning at most 1 result)', () => {
    const rule = makeRule({
      frequency_type: 'biweekly',
      frequency_value: 2,
      day_of_week: 6, // Saturday
      rule_config: { reference_date: '2025-01-04' }, // known Saturday
    });
    // 6-week window: should contain 3 occurrences (Jan 4, Jan 18, Feb 1).
    const results = evaluateRule(rule, local('2025-01-01'), local('2025-02-10'));
    expect(results.map(r => r.date)).toEqual(['2025-01-04', '2025-01-18', '2025-02-01']);
  });

  it('generates every 4 weeks over a longer period', () => {
    const rule = makeRule({
      frequency_type: 'biweekly',
      frequency_value: 4,
      day_of_week: 6,
      rule_config: { reference_date: '2025-01-04' },
    });
    const results = evaluateRule(rule, local('2025-01-01'), local('2025-04-30'));
    // Jan 4, Feb 1, Mar 1, Mar 29, Apr 26
    expect(results.map(r => r.date)).toEqual([
      '2025-01-04', '2025-02-01', '2025-03-01', '2025-03-29', '2025-04-26',
    ]);
  });

  it('works without a reference date (anchors on first matching day)', () => {
    const rule = makeRule({
      frequency_type: 'biweekly',
      frequency_value: 2,
      day_of_week: 6, // Saturday
      rule_config: {},
    });
    // First Saturday on or after Jan 6 (Monday) is Jan 11.
    // Next: Jan 25.
    const results = evaluateRule(rule, local('2025-01-06'), local('2025-01-31'));
    expect(results.map(r => r.date)).toEqual(['2025-01-11', '2025-01-25']);
  });

  it('returns empty when day_of_week is null', () => {
    const rule = makeRule({
      frequency_type: 'biweekly',
      frequency_value: 2,
      day_of_week: null,
    });
    const results = evaluateRule(rule, local('2025-01-01'), local('2025-01-31'));
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Custom rules (legacy)
// ---------------------------------------------------------------------------

describe('custom rules', () => {
  it('always returns empty (deprecated type)', () => {
    const rule = makeRule({ frequency_type: 'custom' });
    const results = evaluateRule(rule, local('2025-01-01'), local('2025-12-31'));
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// evaluateRules — conflict resolution
// ---------------------------------------------------------------------------

describe('evaluateRules conflict resolution', () => {
  it('higher priority rule wins when same date/state/place/time', () => {
    const low  = makeRule({ id: 'low',  priority: 0, leader: 'Alice', day_of_week: 6 });
    const high = makeRule({ id: 'high', priority: 5, leader: 'Bob',   day_of_week: 6 });
    const results = evaluateRules([low, high], local('2025-01-04'), local('2025-01-04'));
    expect(results).toHaveLength(1);
    expect(results[0].rule_id).toBe('high');
  });

  it('different times do not conflict', () => {
    const rule1 = makeRule({ id: 'r1', time: '10:00', day_of_week: 6 });
    const rule2 = makeRule({ id: 'r2', time: '14:00', day_of_week: 6 });
    const results = evaluateRules([rule1, rule2], local('2025-01-04'), local('2025-01-04'));
    expect(results).toHaveLength(2);
  });
});
