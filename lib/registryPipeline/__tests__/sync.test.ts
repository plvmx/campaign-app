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

function makeDb(overrides: Partial<DbPort> = {}): DbPort {
  return {
    startSyncLog: vi.fn().mockResolvedValue(1),
    getLastCompletedSyncTimestamp: vi.fn().mockResolvedValue(null),
    insertStagingEvent: vi.fn().mockResolvedValue(undefined),
    completeSyncLog: vi.fn().mockResolvedValue(undefined),
    failSyncLog: vi.fn().mockResolvedValue(undefined),
    getPendingStagingEvents: vi.fn().mockResolvedValue([]),
    getKnownSourceTags: vi.fn().mockResolvedValue([]),
    upsertRegistrant: vi.fn(),
    insertRegistrationEvent: vi.fn(),
    markStagingProcessed: vi.fn(),
    markStagingError: vi.fn(),
    getSyncProgress: vi.fn().mockResolvedValue(null),
    saveSyncProgress: vi.fn().mockResolvedValue(undefined),
    clearSyncProgress: vi.fn().mockResolvedValue(undefined),
    recordPartialSync: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** A controllable clock for deterministic time-budget tests, without real timers. */
function makeClock(times: number[]): () => number {
  let i = 0;
  return () => {
    const t = times[Math.min(i, times.length - 1)];
    i++;
    return t;
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
    const db = makeDb({ getLastCompletedSyncTimestamp: vi.fn().mockResolvedValue(null) });

    const result = await runSync(ac, db);

    expect(db.insertStagingEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sourceListId: '1', acContactId: 'ac-1', eventType: 'backfill' })
    );
    expect(result.recordsIn).toBe(1);
    expect(result.partial).toBe(false);
  });

  it('tags staging events as sync (not backfill) once a prior completed sync exists', async () => {
    const membership: AcContactListMembership = { contact: 'ac-1', list: '1', status: '1' };
    const ac = makeAc({ '1': [[membership], []], '2': [[]] });
    const db = makeDb({ getLastCompletedSyncTimestamp: vi.fn().mockResolvedValue('2026-08-01T00:00:00Z') });

    await runSync(ac, db);

    expect(db.insertStagingEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'sync' }));
  });

  it('paginates within a single list until an empty page is returned, then clears its progress', async () => {
    const m1: AcContactListMembership = { contact: 'ac-1', list: '2', status: '1' };
    const m2: AcContactListMembership = { contact: 'ac-2', list: '2', status: '1' };
    const ac = makeAc({ '1': [[]], '2': [[m1], [m2], []] });
    const db = makeDb();

    const result = await runSync(ac, db);

    expect(result.recordsIn).toBe(2);
    expect(db.clearSyncProgress).toHaveBeenCalledWith('1');
    expect(db.clearSyncProgress).toHaveBeenCalledWith('2');
  });

  it('completes the sync log with counts from the transform step when a pass fully drains', async () => {
    const ac = makeAc({ '1': [[]], '2': [[]] });
    const db = makeDb();

    const result = await runSync(ac, db);

    expect(db.completeSyncLog).toHaveBeenCalledWith(1, { recordsIn: 0, recordsUpserted: 0, errors: 0 });
    expect(db.recordPartialSync).not.toHaveBeenCalled();
    expect(result.partial).toBe(false);
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

  it('resumes a list from its previously saved offset rather than starting over', async () => {
    const ac = makeAc({ '1': [[]], '2': [[]] });
    const db = makeDb({
      getSyncProgress: vi.fn().mockImplementation(async (listId: string) => (listId === '1' ? 200 : null)),
    });

    await runSync(ac, db);

    const list1Call = (ac.getContactListPage as ReturnType<typeof vi.fn>).mock.calls.find(
      ([params]) => params.listId === '1'
    );
    expect(list1Call?.[0].offset).toBe(200);
  });

  it('stops a list once its own budget slice is exhausted, but still gives every other list its turn', async () => {
    const m1: AcContactListMembership = { contact: 'ac-1', list: '1', status: '1' };
    const m2: AcContactListMembership = { contact: 'ac-2', list: '1', status: '1' };
    // A second page for list 1 would exist, but the clock trips list 1's
    // slice before it's ever fetched. List 2 (a separate, empty list here)
    // must still get its own turn regardless — this is the fix for the
    // real starvation bug found via live data (list 1 never finished
    // across ~200 real invocations, and list 2 was never touched again).
    const ac = makeAc({ '1': [[m1, m2], [{ contact: 'ac-3', list: '1', status: '1' }]], '2': [[]] });
    const db = makeDb();
    // Calls in order: list1 deadline calc, list1 check#1 (passes), list1
    // check#2 (trips list1's slice), list2 deadline calc, list2 check#1 (passes, list2 then hits an empty page and stops on its own).
    const now = makeClock([0, 0, 2000, 2000, 2000]);

    const result = await runSync(ac, db, { acBudgetMs: 1000, now });

    expect(result.partial).toBe(true);
    expect(db.saveSyncProgress).toHaveBeenCalledWith('1', 2);
    expect(db.recordPartialSync).toHaveBeenCalledWith(1, { recordsIn: 2, recordsUpserted: 0, errors: 0 });
    expect(db.completeSyncLog).not.toHaveBeenCalled();
    // List 2 must still be queried even though list 1's slice ran out.
    const queriedLists = (ac.getContactListPage as ReturnType<typeof vi.fn>).mock.calls.map(
      ([params]) => params.listId
    );
    expect(queriedLists).toEqual(['1', '2']);
    expect(db.clearSyncProgress).toHaveBeenCalledWith('2');
  });

  it('still runs the transform step on whatever landed before a partial timeout', async () => {
    const ac = makeAc({ '1': [[{ contact: 'ac-1', list: '1', status: '1' }]], '2': [[]] });
    const db = makeDb();
    const now = makeClock([0, 0, 2000]);

    await runSync(ac, db, { acBudgetMs: 1000, now });

    expect(db.getPendingStagingEvents).toHaveBeenCalled();
  });

  it('gives the transform phase its own fresh budget rather than whatever is left of the AC-pull one', async () => {
    // AC-pull drains both lists instantly (no work), so it never times out —
    // but the transform phase itself reports partial (e.g. a large backlog).
    const ac = makeAc({ '1': [[]], '2': [[]] });
    const db = makeDb({
      getPendingStagingEvents: vi.fn().mockResolvedValue(
        Array.from({ length: 3 }, (_, i) => ({
          id: i + 1,
          raw_payload: {
            contact: { id: `ac-${i}`, email: null, firstName: null, lastName: null, phone: null },
            fieldValues: [],
            tags: [],
            listMembership: { contact: `ac-${i}`, list: '1', status: '1' },
          },
        }))
      ),
      upsertRegistrant: vi.fn().mockResolvedValue({ id: 'registrant-x' }),
      insertRegistrationEvent: vi.fn().mockResolvedValue(undefined),
    });
    // now() sequence: per-list deadline calc + one loop check per list (2
    // lists, both hitting an empty page immediately -> 4 calls), then
    // transformDeadline calc, then one check per pending event inside
    // transform (3 events) — the last of which trips, leaving the 3rd
    // event unprocessed.
    const now = makeClock([0, 0, 0, 0, 0, 0, 0, 5000]);

    const result = await runSync(ac, db, { acBudgetMs: 1000, transformBudgetMs: 1000, now });

    expect(result.partial).toBe(true);
    expect(result.recordsUpserted).toBe(2);
    expect(db.recordPartialSync).toHaveBeenCalledWith(1, { recordsIn: 0, recordsUpserted: 2, errors: 0 });
    expect(db.completeSyncLog).not.toHaveBeenCalled();
  });
});
