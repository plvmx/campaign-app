import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), auth: {} },
}));

import { supabase } from '@/lib/supabaseClient';
import { makeQueryBuilder } from './supabaseMock';
import { getRules, createRule, updateRule, deleteRule, setRuleActive } from '../rulesService';
import type { CampaignRuleInput } from '@/lib/types';

const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getRules', () => {
  it('AD sees all rules — no state/leader filter applied', async () => {
    const builder = makeQueryBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await getRules({ adminStatus: 'AD', userState: 'VIC', userLeader: 'Alice' });
    expect(builder.eq).not.toHaveBeenCalled();
  });

  it('SR sees only their state', async () => {
    const builder = makeQueryBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await getRules({ adminStatus: 'SR', userState: 'vic', userLeader: null });
    expect(builder.eq).toHaveBeenCalledWith('state', 'VIC');
  });

  it('a team leader sees only their own state+leader rules', async () => {
    const builder = makeQueryBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await getRules({ adminStatus: null, userState: 'vic', userLeader: 'Alice' });
    expect(builder.eq).toHaveBeenCalledWith('state', 'VIC');
    expect(builder.eq).toHaveBeenCalledWith('leader', 'Alice');
  });

  it('a team leader with no leader name gets [] without querying', async () => {
    await getRules({ adminStatus: null, userState: 'VIC', userLeader: null });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(getRules({ adminStatus: 'AD', userState: null, userLeader: null })).rejects.toEqual(error);
  });
});

describe('createRule / updateRule / deleteRule / setRuleActive', () => {
  const rule: CampaignRuleInput = {
    name: 'Weekly Melbourne', leader: 'Alice', state: 'VIC', place: 'Melbourne', site: '', time: '10:00',
    mobile: null, frequency_type: 'weekly', frequency_value: null, month_week_number: null,
    month_day_of_week: null, day_of_week: 6, start_date: null, end_date: null,
    is_active: true, priority: 0, rule_config: {}, notes: null,
  };

  it('createRule inserts with the created_by stamp', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await createRule(rule, 'user-1');
    expect(builder.insert).toHaveBeenCalledWith([{ ...rule, created_by: 'user-1' }]);
  });

  it('createRule throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(createRule(rule, 'user-1')).rejects.toEqual(error);
  });

  it('updateRule updates by id', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await updateRule('r1', { time: '11:00' });
    expect(builder.update).toHaveBeenCalledWith({ time: '11:00' });
    expect(builder.eq).toHaveBeenCalledWith('id', 'r1');
  });

  it('deleteRule deletes by id', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await deleteRule('r1');
    expect(builder.eq).toHaveBeenCalledWith('id', 'r1');
  });

  it('setRuleActive toggles is_active by id', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await setRuleActive('r1', false);
    expect(builder.update).toHaveBeenCalledWith({ is_active: false });
    expect(builder.eq).toHaveBeenCalledWith('id', 'r1');
  });
});
