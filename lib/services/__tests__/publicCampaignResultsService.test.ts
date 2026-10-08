import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeQueryBuilder } from './supabaseMock';
import { getDisplayedResultsWeekStart, getLastSuccessfulWeeklyRefreshAt } from '../publicCampaignResultsService';
import { formatDateForDb } from '@/lib/campaignDates';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

describe('getDisplayedResultsWeekStart', () => {
  // Refresh ran Sunday 4 Oct 2026 -> it kept the week of Mon 28 Sep.
  const lastRefresh = at(2026, 10, 4);

  it('shows the week the last refresh kept', () => {
    expect(formatDateForDb(getDisplayedResultsWeekStart(lastRefresh, at(2026, 10, 5)))).toBe('2026-09-28');
  });

  it('keeps showing that week on Thursday to Saturday, not the in-progress week', () => {
    expect(formatDateForDb(getDisplayedResultsWeekStart(lastRefresh, at(2026, 10, 8)))).toBe('2026-09-28');
    expect(formatDateForDb(getDisplayedResultsWeekStart(lastRefresh, at(2026, 10, 10)))).toBe('2026-09-28');
  });

  it('still shows it on the next Sunday until that refresh has actually run', () => {
    expect(formatDateForDb(getDisplayedResultsWeekStart(lastRefresh, at(2026, 10, 11, 9)))).toBe('2026-09-28');
  });

  it('moves on to the week just ended once the next Sunday refresh has run', () => {
    expect(formatDateForDb(getDisplayedResultsWeekStart(at(2026, 10, 11), at(2026, 10, 11, 13)))).toBe('2026-10-05');
  });

  it('keeps showing the old week if a scheduled refresh is missed', () => {
    expect(formatDateForDb(getDisplayedResultsWeekStart(lastRefresh, at(2026, 10, 13)))).toBe('2026-09-28');
  });

  it('follows a manual mid-week refresh, which deletes the previous week early', () => {
    // Manual run Thursday 8 Oct deletes everything before Mon 5 Oct.
    expect(formatDateForDb(getDisplayedResultsWeekStart(at(2026, 10, 8), at(2026, 10, 9)))).toBe('2026-10-05');
  });

  it('falls back to the date-based past week when no refresh has been logged', () => {
    expect(formatDateForDb(getDisplayedResultsWeekStart(null, at(2026, 10, 6)))).toBe('2026-09-28');
    expect(formatDateForDb(getDisplayedResultsWeekStart(null, at(2026, 10, 8)))).toBe('2026-10-05');
  });
});

describe('getLastSuccessfulWeeklyRefreshAt', () => {
  const clientFor = (result: { data: unknown; error: unknown }) => {
    const builder = makeQueryBuilder(result);
    const from = vi.fn().mockReturnValue(builder);
    return { client: { from } as unknown as SupabaseClient, from, builder };
  };

  it('returns the newest run that has no error_message', async () => {
    const { client, from, builder } = clientFor({ data: { completed_at: '2026-10-04T01:21:19.704+00:00' }, error: null });
    const result = await getLastSuccessfulWeeklyRefreshAt(client);
    expect(result?.toISOString()).toBe('2026-10-04T01:21:19.704Z');
    expect(from).toHaveBeenCalledWith('weekly_refresh_log');
    expect(builder.is).toHaveBeenCalledWith('error_message', null);
    expect(builder.order).toHaveBeenCalledWith('completed_at', { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(1);
  });

  it('returns null when no refresh has been logged', async () => {
    const { client } = clientFor({ data: null, error: null });
    expect(await getLastSuccessfulWeeklyRefreshAt(client)).toBeNull();
  });

  it('throws the Supabase error rather than silently falling back', async () => {
    const { client } = clientFor({ data: null, error: { message: 'boom' } });
    await expect(getLastSuccessfulWeeklyRefreshAt(client)).rejects.toEqual({ message: 'boom' });
  });
});
