import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeQueryBuilder } from './supabaseMock';
import { recordLegacyReportVisit, getLegacyReportVisitSummary } from '../legacyReportVisitService';

function clientWith(result: { data: unknown; error: unknown }) {
  const builder = makeQueryBuilder(result);
  const from = vi.fn().mockReturnValue(builder);
  return { client: { from } as unknown as SupabaseClient, from, builder };
}

describe('recordLegacyReportVisit', () => {
  it('inserts the validated device id', async () => {
    const { client, from, builder } = clientWith({ data: null, error: null });
    await recordLegacyReportVisit(client, '123e4567-e89b-12d3-a456-426614174000');
    expect(from).toHaveBeenCalledWith('legacy_report_visits');
    expect(builder.insert).toHaveBeenCalledWith({ device_id: '123e4567-e89b-12d3-a456-426614174000' });
  });

  it('still counts the visit when the device id is junk, storing null', async () => {
    const { client, builder } = clientWith({ data: null, error: null });
    await recordLegacyReportVisit(client, '<script>');
    expect(builder.insert).toHaveBeenCalledWith({ device_id: null });
  });

  it('throws on a database error', async () => {
    const { client } = clientWith({ data: null, error: { message: 'boom' } });
    await expect(recordLegacyReportVisit(client, undefined)).rejects.toThrow('boom');
  });
});

describe('getLegacyReportVisitSummary', () => {
  it('summarises the stored rows', async () => {
    const { client } = clientWith({ data: [{ visited_at: '2026-11-11T01:00:00Z', device_id: 'aaaaaaaa' }], error: null });
    const s = await getLegacyReportVisitSummary(client, new Date('2026-11-11T02:00:00Z').getTime());
    expect(s.totalVisits).toBe(1);
    expect(s.last7Days).toBe(1);
  });

  it('throws on a database error', async () => {
    const { client } = clientWith({ data: null, error: { message: 'nope' } });
    await expect(getLegacyReportVisitSummary(client)).rejects.toThrow('nope');
  });
});
