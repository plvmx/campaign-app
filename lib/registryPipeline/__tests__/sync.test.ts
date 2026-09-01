import { describe, expect, it, vi } from 'vitest';
import { computePageSize, KNOWN_LIST_SIZES, MAX_CONSECUTIVE_EMPTY_MATCH_PAGES, MAX_OFFSET_MULTIPLIER, runSync } from '../sync';
import type { AcPort, DbPort } from '../ports';
import type { AcContactListMembership } from '../types';

// Real pacing delay (rateLimiter.ts's REQUEST_PACING_MS) stubbed to zero —
// tests here exercise dozens of pages in the empty-match-page tests, which
// would otherwise take real seconds for no testing value.
vi.mock('../rateLimiter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rateLimiter')>();
  return { ...actual, sleep: vi.fn().mockResolvedValue(undefined) };
});

function makeAc(pagesByList: Record<string, AcContactListMembership[][]>): AcPort {
  const calls: Record<string, number> = {};
  return {
    getContactListPage: vi.fn(async ({ listId }: { listId: string }) => {
      calls[listId] = (calls[listId] ?? 0) + 1;
      const pages = pagesByList[listId] ?? [];
      return pages[calls[listId] - 1] ?? [];
    }),
    getContactDetail: vi.fn(async (contactId: string) => ({
      core: { id: contactId, email: null, firstName: null, lastName: null, phone: null, cdate: null },
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

  it('discards a returned membership whose own list does not match what was requested (defense-in-depth against a broken AC filter)', async () => {
    // Confirmed via real invocation data: AC's list filter did not
    // actually filter, and returned List 3/5 memberships while List 1 was
    // being queried. A page mixing genuine List-1 rows with contamination
    // must only land the genuine ones — regardless of what AC's own
    // filter parameter claims to have already done.
    const wanted: AcContactListMembership = { contact: 'ac-1', list: '1', status: '1' };
    const contaminated1: AcContactListMembership = { contact: 'ac-2', list: '3', status: '1' };
    const contaminated2: AcContactListMembership = { contact: 'ac-3', list: '5', status: '1' };
    const ac = makeAc({ '1': [[wanted, contaminated1, contaminated2], []], '2': [[]] });
    const db = makeDb();

    const result = await runSync(ac, db);

    expect(result.recordsIn).toBe(1);
    expect(db.insertStagingEvent).toHaveBeenCalledTimes(1);
    expect(db.insertStagingEvent).toHaveBeenCalledWith(expect.objectContaining({ acContactId: 'ac-1' }));
    // Pagination still advances by the RAW page size (3), not the
    // filtered count (1) — offset tracks AC's own result-set position.
    expect(db.saveSyncProgress).toHaveBeenCalledWith('1', 3);
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
    // Calls in order: list1 deadline calc, list1 page-loop check (passes),
    // per-contact check before m1 (passes), per-contact check before m2
    // (passes) — page finishes fully — list1 page-loop check again (trips
    // list1's slice before a second page is ever fetched), list2 deadline
    // calc, list2 page-loop check (passes, list2 then hits an empty page
    // and stops on its own).
    const now = makeClock([0, 0, 0, 0, 2000, 2000, 2000]);

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

  it('times out mid-page (not just between pages) and leaves the offset unadvanced for a clean resume', async () => {
    // Real invocation data showed wall-clock time running far past the
    // nominal budget — traced to this loop having no deadline check once a
    // page of up to 100 contacts started processing. This proves the fix:
    // a 3-contact page, clock trips after the first contact.
    const m1: AcContactListMembership = { contact: 'ac-1', list: '1', status: '1' };
    const m2: AcContactListMembership = { contact: 'ac-2', list: '1', status: '1' };
    const m3: AcContactListMembership = { contact: 'ac-3', list: '1', status: '1' };
    const ac = makeAc({ '1': [[m1, m2, m3]], '2': [[]] });
    const db = makeDb();
    // Calls: list1 deadline calc, list1 page-loop check (passes),
    // per-contact check before m1 (passes), per-contact check before m2
    // (trips mid-page — m2 and m3 never touched).
    const now = makeClock([0, 0, 0, 2000]);

    const result = await runSync(ac, db, { acBudgetMs: 1000, now });

    expect(result.recordsIn).toBe(1);
    expect(db.insertStagingEvent).toHaveBeenCalledTimes(1);
    expect(db.insertStagingEvent).toHaveBeenCalledWith(expect.objectContaining({ acContactId: 'ac-1' }));
    // Offset must never advance for a page that didn't finish — the next
    // invocation needs to re-fetch this exact page, not skip past it.
    expect(db.saveSyncProgress).not.toHaveBeenCalledWith('1', expect.anything());
    expect(result.partial).toBe(true);
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
            contact: { id: `ac-${i}`, email: null, firstName: null, lastName: null, phone: null, cdate: null },
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

  it('requests a page size scaled to the actual budget, not the fixed AC maximum', async () => {
    // Real incident (2026-08-31): a fixed page size of 100 could never
    // finish within a tightened budget, so the pagination offset could
    // never advance — a silent, permanent stall. Every invocation must
    // request a page it can actually finish.
    const ac = makeAc({ '1': [[]], '2': [[]] });
    const db = makeDb();

    await runSync(ac, db, { acBudgetMs: 2000 }); // 1000ms per list -> pageSize = floor(500/1000) = 0, clamped to 1

    const list1Call = (ac.getContactListPage as ReturnType<typeof vi.fn>).mock.calls.find(
      ([params]) => params.listId === '1'
    );
    expect(list1Call?.[0].limit).toBe(1);
  });

  it('treats a list as exhausted after many consecutive pages with zero genuine matches, even without a literal empty page', async () => {
    // Real incident: List 2's pagination offset reached 12,852 while its
    // true size was ~4,204 — a literal empty page never occurred, because
    // AC's list filter doesn't actually filter. Every page here has one
    // item, but none of them match list '1' — the loop must still stop on
    // its own rather than scanning forever.
    const contamination = (n: number): AcContactListMembership[] => [{ contact: `c-${n}`, list: '3', status: '1' }];
    const pages = Array.from({ length: MAX_CONSECUTIVE_EMPTY_MATCH_PAGES }, (_, i) => contamination(i));
    const ac = makeAc({ '1': pages, '2': [[]] });
    const db = makeDb();

    const result = await runSync(ac, db);

    const list1Calls = (ac.getContactListPage as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([params]) => params.listId === '1'
    );
    expect(list1Calls.length).toBe(MAX_CONSECUTIVE_EMPTY_MATCH_PAGES);
    expect(db.clearSyncProgress).toHaveBeenCalledWith('1');
    expect(result.recordsIn).toBe(0);
    expect(result.partial).toBe(false);
  });

  it('resets the consecutive-empty-match-page count once a genuine match is found, rather than accumulating across it', async () => {
    const contamination = (n: number): AcContactListMembership[] => [{ contact: `c-${n}`, list: '3', status: '1' }];
    const genuineMatch: AcContactListMembership[] = [{ contact: 'real-1', list: '1', status: '1' }];
    // 30 contamination-only pages, one genuine match, then 29 more
    // contamination-only pages — no single unbroken streak reaches the
    // 50-page threshold, so the list must NOT be declared exhausted early.
    const pages = [
      ...Array.from({ length: 30 }, (_, i) => contamination(i)),
      genuineMatch,
      ...Array.from({ length: 29 }, (_, i) => contamination(i + 30)),
    ];
    const ac = makeAc({ '1': pages, '2': [[]] });
    const db = makeDb();

    const result = await runSync(ac, db);

    const list1Calls = (ac.getContactListPage as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([params]) => params.listId === '1'
    );
    // All 60 provided pages consumed, plus one more call that falls
    // through to an empty array — the ordinary empty-page path is what
    // actually ends this list, not the consecutive-empty-match heuristic.
    expect(list1Calls.length).toBe(61);
    expect(result.recordsIn).toBe(1);
    expect(db.insertStagingEvent).toHaveBeenCalledWith(expect.objectContaining({ acContactId: 'real-1' }));
  });

  it('treats a list as exhausted once its offset passes the known-size safety multiplier, even with genuine matches still trickling in', async () => {
    // Real incident: List 2's offset reached 13,236 against a true size of
    // ~4,204 — sparse-but-nonzero genuine matches (already-known contacts
    // resurfacing, not new content) kept resetting the consecutive-empty
    // streak just before it ever reached the threshold. This is the
    // second, independent safety net for exactly that case.
    const genuineMatch: AcContactListMembership[] = [{ contact: 'real-1', list: '2', status: '1' }];
    const ac = makeAc({ '1': [[]], '2': [genuineMatch, genuineMatch, genuineMatch] });
    const startingOffset = KNOWN_LIST_SIZES['2'] * MAX_OFFSET_MULTIPLIER;
    const db = makeDb({ getSyncProgress: vi.fn().mockImplementation(async (listId: string) => (listId === '2' ? startingOffset : null)) });

    const result = await runSync(ac, db);

    const list2Calls = (ac.getContactListPage as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([params]) => params.listId === '2'
    );
    expect(list2Calls.length).toBe(0);
    expect(db.clearSyncProgress).toHaveBeenCalledWith('2');
    expect(result.recordsIn).toBe(0);
  });
});

describe('computePageSize', () => {
  it('never exceeds the AC maximum of 100, even with a huge budget', () => {
    expect(computePageSize(10_000_000)).toBe(100);
  });

  it('scales down with a smaller per-list budget', () => {
    // 32_500ms per list (the 65s/65s Pro-tier default), at the 1000ms/contact estimate.
    expect(computePageSize(32_500)).toBe(16);
  });

  it('never returns less than 1, even with a near-zero budget', () => {
    expect(computePageSize(1)).toBe(1);
    expect(computePageSize(0)).toBe(1);
  });

  it('scales up with a larger per-list budget, up to the AC maximum', () => {
    expect(computePageSize(60_000)).toBe(30);
  });
});
