import { describe, expect, it, vi } from 'vitest';
import { runSync } from '../sync';
import type { AcPort, DbPort } from '../ports';
import type { AcContactListMembership } from '../types';

function makeAc(pagesByList: Record<string, AcContactListMembership[][]>): AcPort {
  const calls: Record<string, number> = {};
  return {
    getContactListPage: vi.fn(async ({ listId }: { listId: string }) => {
      calls[listId] = (calls[listId] ?? 0) + 1;
      const pages = pagesByList[listId] ?? [];
      return pages[calls[listId] - 1] ?? [];
    }),
    getContactDetail: vi.fn(async (contactId: string) => ({
      core: { id: contactId, email: null, firstName: null, lastName: null, phone: null },
      fieldValues: [],
      tags: [],
    })),
  };
}

function makeDb(lastSync: string | null = null): DbPort {
  return {
    startSyncLog: vi.fn().mockResolvedValue(1),
    getLastCompletedSyncTimestamp: vi.fn().mockResolvedValue(lastSync),
    insertStagingEvent: vi.fn().mockResolvedValue(undefined),
    completeSyncLog: vi.fn().mockResolvedValue(undefined),
    failSyncLog: vi.fn().mockResolvedValue(undefined),
    getPendingStagingEvents: vi.fn().mockResolvedValue([]),
    getKnownSourceTags: vi.fn().mockResolvedValue([]),
    upsertRegistrant: vi.fn(),
    insertRegistrationEvent: vi.fn(),
    markStagingProcessed: vi.fn(),
    markStagingError: vi.fn(),
  };
}

describe('runSync', () => {
  it('never queries List 3 or List 5 at all', async () => {
    const ac = makeAc({ '1': [[]], '2': [[]] });
    const db = makeDb();

    await runSync(ac, db);

    const queriedLists = (ac.getContactListPage as ReturnType<typeof vi.fn>).mock.calls.map(
      ([params]) => params.listId
    );
    expect(queriedLists).toEqual(['1', '2']);
  });

  it('lands one staging event per contact-list membership row, tagged backfill on the first-ever run', async () => {
    const membership: AcContactListMembership = { contact: 'ac-1', list: '1', status: '1' };
    const ac = makeAc({ '1': [[membership], []], '2': [[]] });
    const db = makeDb(null);

    const result = await runSync(ac, db);

    expect(db.insertStagingEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sourceListId: '1', acContactId: 'ac-1', eventType: 'backfill' })
    );
    expect(result.recordsIn).toBe(1);
  });

  it('tags staging events as sync (not backfill) once a prior completed sync exists', async () => {
    const membership: AcContactListMembership = { contact: 'ac-1', list: '1', status: '1' };
    const ac = makeAc({ '1': [[membership], []], '2': [[]] });
    const db = makeDb('2026-08-01T00:00:00Z');

    await runSync(ac, db);

    expect(db.insertStagingEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'sync' }));
  });

  it('paginates within a single list until an empty page is returned', async () => {
    const m1: AcContactListMembership = { contact: 'ac-1', list: '2', status: '1' };
    const m2: AcContactListMembership = { contact: 'ac-2', list: '2', status: '1' };
    const ac = makeAc({ '1': [[]], '2': [[m1], [m2], []] });
    const db = makeDb();

    const result = await runSync(ac, db);

    expect(result.recordsIn).toBe(2);
  });

  it('completes the sync log with counts from the transform step', async () => {
    const ac = makeAc({ '1': [[]], '2': [[]] });
    const db = makeDb();
    db.getPendingStagingEvents = vi.fn().mockResolvedValue([]);

    await runSync(ac, db);

    expect(db.completeSyncLog).toHaveBeenCalledWith(1, { recordsIn: 0, recordsUpserted: 0, errors: 0 });
  });

  it('fails the sync log and rethrows when the AC call throws', async () => {
    const ac: AcPort = {
      getContactListPage: vi.fn().mockRejectedValue(new Error('AC unreachable')),
      getContactDetail: vi.fn(),
    };
    const db = makeDb();

    await expect(runSync(ac, db)).rejects.toThrow('AC unreachable');
    expect(db.failSyncLog).toHaveBeenCalledWith(1, 'AC unreachable');
  });
});
