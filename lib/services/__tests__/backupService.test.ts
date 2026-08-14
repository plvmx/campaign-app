import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeQueryBuilder, type MockQueryBuilder } from './supabaseMock';
import {
  BACKUP_TABLE_CONFIG,
  exportBackup,
  restoreBackup,
  isValidBackupFile,
  type BackupData,
} from '../backupService';

type TableResponse = { data: unknown; error: unknown };

/**
 * Routing fake for the multi-table client both exportBackup and restoreBackup
 * depend on. Each table gets its own queue of canned responses, consumed in
 * call order (mirrors weeklyRefreshService.test.ts's makeClient) — and every
 * builder handed out is kept, in the exact order it was created, so tests can
 * assert cross-table call ordering via `mock.invocationCallOrder`.
 */
function makeClient(responses: Partial<Record<string, TableResponse[]>> = {}) {
  const counters: Record<string, number> = {};
  const builders: Record<string, MockQueryBuilder[]> = {};
  const callOrder: string[] = [];
  const from = vi.fn((table: string) => {
    const queue = responses[table] ?? [];
    const idx = counters[table] ?? 0;
    counters[table] = idx + 1;
    const result = queue[idx] ?? { data: [], error: null };
    const builder = makeQueryBuilder(result);
    (builders[table] ??= []).push(builder);
    // Wrap the four "operation" methods so we can read back a flat, ordered
    // log of exactly which table+operation fired when, across every table —
    // simpler than comparing raw invocationCallOrder numbers by hand.
    (['select', 'insert', 'upsert', 'delete'] as const).forEach((op) => {
      const original = builder[op] as unknown as (...args: unknown[]) => MockQueryBuilder;
      (builder[op] as MockQueryBuilder[typeof op]) = vi.fn((...args: unknown[]) => {
        callOrder.push(`${table}:${op}`);
        return original(...args);
      });
    });
    return builder;
  });
  const client = { from } as unknown as SupabaseClient;
  return { client, builders, callOrder };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isValidBackupFile', () => {
  it('accepts an object with exported_at and version strings', () => {
    expect(isValidBackupFile({ exported_at: '2026-01-01T00:00:00Z', version: '2' })).toBe(true);
  });

  it.each([
    null,
    undefined,
    {},
    { exported_at: '2026-01-01T00:00:00Z' },
    { version: '2' },
    { exported_at: 1, version: '2' },
  ])('rejects %j', (input) => {
    expect(isValidBackupFile(input)).toBe(false);
  });
});

describe('exportBackup', () => {
  it('exports only the selected tables, keyed by their BackupTableKey', async () => {
    const { client } = makeClient({
      state_leaders: [{ data: [{ id: 'l1', state: 'VIC', leader: 'Alice' }], error: null }],
      campaigns: [{ data: [{ id: 'c1', date: '2026-08-10' }], error: null }],
    });

    const backup = await exportBackup(client, ['state_leaders', 'campaigns']);

    expect(backup.state_leaders).toEqual([{ id: 'l1', state: 'VIC', leader: 'Alice' }]);
    expect(backup.campaigns).toEqual([{ id: 'c1', date: '2026-08-10' }]);
    expect(backup.results).toBeUndefined();
    expect(backup.exported_at).toEqual(expect.any(String));
    expect(backup.version).toEqual(expect.any(String));
  });

  it('processes tables in BACKUP_TABLE_CONFIG order regardless of the input array order', async () => {
    const { client } = makeClient({
      results: [{ data: [], error: null }],
      campaigns: [{ data: [], error: null }],
    });
    const progress: string[] = [];

    // Pass 'results' before 'campaigns' — config order puts campaigns first.
    await exportBackup(client, ['results', 'campaigns'], (msg) => progress.push(msg));

    const campaignsIdx = progress.findIndex((m) => m.includes('Campaigns'));
    const resultsIdx = progress.findIndex((m) => m.includes('Results'));
    expect(campaignsIdx).toBeGreaterThanOrEqual(0);
    expect(campaignsIdx).toBeLessThan(resultsIdx);
  });

  it('propagates a fetch error', async () => {
    const error = { code: '42501', message: 'denied' };
    const { client } = makeClient({ campaigns: [{ data: null, error }] });
    await expect(exportBackup(client, ['campaigns'])).rejects.toEqual(error);
  });

  it('defaults an empty/null result to an empty array', async () => {
    const { client } = makeClient({ app_settings: [{ data: null, error: null }] });
    const backup = await exportBackup(client, ['app_settings']);
    expect(backup.app_settings).toEqual([]);
  });
});

describe('restoreBackup', () => {
  const backup = (data: Partial<Record<string, unknown[]>>): BackupData => ({
    exported_at: '2026-08-10T00:00:00Z',
    version: '2',
    ...data,
  }) as BackupData;

  it('merge mode upserts each selected table and never deletes', async () => {
    const { client, builders } = makeClient();
    await restoreBackup(
      client,
      backup({ state_leaders: [{ id: 'l1' }], campaigns: [{ id: 'c1' }] }),
      ['state_leaders', 'campaigns'],
      'merge',
    );

    expect(builders.state_leaders[0].upsert).toHaveBeenCalledWith([{ id: 'l1' }]);
    expect(builders.campaigns[0].upsert).toHaveBeenCalledWith([{ id: 'c1' }]);
    expect(builders.state_leaders[0].delete).not.toHaveBeenCalled();
    expect(builders.campaigns[0].delete).not.toHaveBeenCalled();
  });

  it('replace mode clears children before parents, then inserts parents before children (FK-safe)', async () => {
    const { client, callOrder } = makeClient({
      // deleteAllRecords does a select() for current keys before deleting.
      campaigns: [{ data: [{ id: 'existing-campaign' }], error: null }],
      results: [{ data: [{ id: 'existing-result' }], error: null }],
    });

    // Selected out of dependency order on purpose — restoreBackup must not
    // just follow the caller's array order.
    await restoreBackup(
      client,
      backup({ results: [{ id: 'r1', campaign_id: 'c1' }], campaigns: [{ id: 'c1' }] }),
      ['results', 'campaigns'],
      'replace',
    );

    expect(callOrder).toEqual([
      // Delete pass: reverse config order — results (child) before campaigns (parent).
      'results:select', 'results:delete',
      'campaigns:select', 'campaigns:delete',
      // Insert pass: forward config order — campaigns (parent) before results (child).
      'campaigns:insert',
      'results:insert',
    ]);
  });

  it('replace mode inserts, not upserts', async () => {
    // Non-empty current rows so the delete pass actually runs (a builder per
    // step), then assert against the *last* builder for the table — robust
    // to however many delete-phase builders precede the insert.
    const { client, builders } = makeClient({
      campaigns: [{ data: [{ id: 'existing-campaign' }], error: null }],
    });
    await restoreBackup(client, backup({ campaigns: [{ id: 'c1' }] }), ['campaigns'], 'replace');

    const lastBuilder = builders.campaigns[builders.campaigns.length - 1];
    expect(lastBuilder.insert).toHaveBeenCalledWith([{ id: 'c1' }]);
    expect(builders.campaigns.some((b) => b.upsert.mock.calls.length > 0)).toBe(false);
  });

  it('skips a table that is selected but absent from the backup file', async () => {
    const { client, builders } = makeClient();
    await restoreBackup(client, backup({ campaigns: [{ id: 'c1' }] }), ['campaigns', 'results'], 'merge');

    expect(builders.results).toBeUndefined();
    expect(builders.campaigns[0].upsert).toHaveBeenCalledWith([{ id: 'c1' }]);
  });

  it('skips a table that is present in the backup but not selected', async () => {
    const { client, builders } = makeClient();
    await restoreBackup(
      client,
      backup({ campaigns: [{ id: 'c1' }], results: [{ id: 'r1' }] }),
      ['campaigns'],
      'merge',
    );

    expect(builders.results).toBeUndefined();
  });

  it('batches inserts in groups of 500', async () => {
    // Empty current rows: the delete pass's batch loop never runs (nothing
    // to delete), so the only builders created for 'campaigns' are the
    // initial select plus one per insert batch.
    const { client, builders } = makeClient({ campaigns: [{ data: [], error: null }] });
    const records = Array.from({ length: 501 }, (_, i) => ({ id: `c${i}` }));

    await restoreBackup(client, backup({ campaigns: records }), ['campaigns'], 'replace');

    expect(builders.campaigns).toHaveLength(3); // select + 2 insert batches
    expect(builders.campaigns[1].insert).toHaveBeenCalledWith(records.slice(0, 500));
    expect(builders.campaigns[2].insert).toHaveBeenCalledWith(records.slice(500));
  });

  it('deletes using the table-specific key field (e.g. campaign_messages keyed by date)', async () => {
    const { client, builders } = makeClient({
      campaign_messages: [{ data: [{ date: '2026-08-01' }, { date: '2026-08-08' }], error: null }],
    });

    await restoreBackup(
      client,
      backup({ campaign_messages: [{ date: '2026-08-10', message: 'Hi' }] }),
      ['campaign_messages'],
      'replace',
    );

    // builders[0] is the select-current-keys call; the delete + .in() land on
    // the next builder, since deleteAllRecords calls client.from() again for it.
    expect(builders.campaign_messages[1].in).toHaveBeenCalledWith('date', ['2026-08-01', '2026-08-08']);
  });

  it('propagates a delete error in replace mode', async () => {
    const error = { code: '42501', message: 'denied' };
    const { client } = makeClient({
      campaigns: [
        { data: [{ id: 'c1' }], error: null }, // select current ids
        { data: null, error },                  // delete
      ],
    });
    await expect(
      restoreBackup(client, backup({ campaigns: [{ id: 'c1' }] }), ['campaigns'], 'replace'),
    ).rejects.toEqual(error);
  });

  it('propagates an upsert error in merge mode', async () => {
    const error = { code: '23505', message: 'duplicate key' };
    const { client } = makeClient({ campaigns: [{ data: null, error }] });
    await expect(
      restoreBackup(client, backup({ campaigns: [{ id: 'c1' }] }), ['campaigns'], 'merge'),
    ).rejects.toEqual(error);
  });
});

describe('BACKUP_TABLE_CONFIG', () => {
  it('lists results after campaigns (FK: results.campaign_id -> campaigns.id)', () => {
    const keys = BACKUP_TABLE_CONFIG.map((c) => c.key);
    expect(keys.indexOf('campaigns')).toBeLessThan(keys.indexOf('results'));
  });

  it('lists campaign_interest after campaigns (FK: campaign_interest.campaign_id -> campaigns.id)', () => {
    const keys = BACKUP_TABLE_CONFIG.map((c) => c.key);
    expect(keys.indexOf('campaigns')).toBeLessThan(keys.indexOf('campaign_interest'));
  });

  it('has a unique key and table for every entry', () => {
    const keys = BACKUP_TABLE_CONFIG.map((c) => c.key);
    const tables = BACKUP_TABLE_CONFIG.map((c) => c.table);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(tables).size).toBe(tables.length);
  });
});
