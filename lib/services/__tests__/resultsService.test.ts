import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), auth: {} },
}));

import { supabase } from '@/lib/supabaseClient';
import { makeQueryBuilder } from './supabaseMock';
import { getResultsByCampaignId, insertResults, updateResult, deleteResult } from '../resultsService';

const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getResultsByCampaignId', () => {
  it('returns rows ordered by created_at', async () => {
    const rows = [{ id: '1', first_name: 'Alice', category_code: 'P', created_at: '2026-01-01' }];
    mockFrom.mockReturnValue(makeQueryBuilder({ data: rows, error: null }));
    expect(await getResultsByCampaignId('c1')).toEqual(rows);
  });

  it('returns [] rather than null when no rows found', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    expect(await getResultsByCampaignId('c1')).toEqual([]);
  });

  it('throws on error', async () => {
    const error = { code: '42501', message: 'denied' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(getResultsByCampaignId('c1')).rejects.toEqual(error);
  });
});

// Regression coverage for #69: a batch insert that included a 'TM' row used
// to be rejected wholesale by a DB check constraint (fixed at the DB layer,
// not here), but insertResults's job is to propagate whatever error comes
// back rather than silently returning an empty/partial result.
describe('insertResults', () => {
  it('returns [] immediately for an empty array without calling Supabase', async () => {
    expect(await insertResults([])).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('inserts each row in its own round-trip and returns them in input order', async () => {
    const rowAlice = { id: '1', first_name: 'Alice', category_code: 'TM' };
    const rowBob   = { id: '2', first_name: 'Bob', category_code: 'P' };
    const builderAlice = makeQueryBuilder({ data: rowAlice, error: null });
    const builderBob   = makeQueryBuilder({ data: rowBob, error: null });
    mockFrom.mockReturnValueOnce(builderAlice).mockReturnValueOnce(builderBob);

    const rows = [
      { campaign_id: 'c1', first_name: 'Alice', category_code: 'TM', user_id: 'u1' },
      { campaign_id: 'c1', first_name: 'Bob', category_code: 'P', user_id: 'u1' },
    ];
    const result = await insertResults(rows);

    expect(builderAlice.insert).toHaveBeenCalledWith([rows[0]]);
    expect(builderBob.insert).toHaveBeenCalledWith([rows[1]]);
    expect(result).toEqual([rowAlice, rowBob]);
  });

  it('preserves input-order correspondence even when later rows resolve before earlier ones', async () => {
    // Row 0 resolves after row 1 — Promise.all must still return [row0Result, row1Result]
    // in that order, since the caller maps ids back onto its in-memory rows by array index.
    const rowFast = { id: 'fast', first_name: 'Zed', category_code: 'P' };
    const rowSlow = { id: 'slow', first_name: 'Amy', category_code: 'F' };
    let resolveSlow!: (v: { data: unknown; error: unknown }) => void;
    const slowBuilder = makeQueryBuilder({ data: rowSlow, error: null });
    slowBuilder.single = vi.fn().mockReturnValue(
      new Promise((resolve) => { resolveSlow = resolve; }),
    );
    const fastBuilder = makeQueryBuilder({ data: rowFast, error: null });
    mockFrom.mockReturnValueOnce(slowBuilder).mockReturnValueOnce(fastBuilder);

    const promise = insertResults([
      { campaign_id: 'c1', first_name: 'Amy', category_code: 'F', user_id: 'u1' },
      { campaign_id: 'c1', first_name: 'Zed', category_code: 'P', user_id: 'u1' },
    ]);

    // Let the "fast" (second) request resolve first.
    await Promise.resolve();
    resolveSlow({ data: rowSlow, error: null });

    expect(await promise).toEqual([rowSlow, rowFast]);
  });

  it('propagates the real Supabase error instead of swallowing it (the #69 failure mode)', async () => {
    const error = {
      message: 'new row violates check constraint "results_category_code_check"',
      code: '23514',
    };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(
      insertResults([{ campaign_id: 'c1', first_name: 'Carl', category_code: 'TM', user_id: 'u1' }]),
    ).rejects.toEqual(error);
  });

  it('throws when Supabase returns no row despite no error, rather than silently returning a hole', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    await expect(
      insertResults([{ campaign_id: 'c1', first_name: 'Carl', category_code: 'TM', user_id: 'u1' }]),
    ).rejects.toThrow('Insert succeeded but no row was returned');
  });
});

describe('updateResult', () => {
  it('updates by id with the given fields', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await updateResult('r1', { first_name: 'Alice', category_code: 'F' });
    expect(builder.update).toHaveBeenCalledWith({ first_name: 'Alice', category_code: 'F' });
    expect(builder.eq).toHaveBeenCalledWith('id', 'r1');
  });

  it('throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(updateResult('r1', { first_name: 'Alice', category_code: 'F' })).rejects.toEqual(error);
  });
});

describe('deleteResult', () => {
  it('deletes by id', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await deleteResult('r1');
    expect(builder.eq).toHaveBeenCalledWith('id', 'r1');
  });

  it('throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(deleteResult('r1')).rejects.toEqual(error);
  });
});
