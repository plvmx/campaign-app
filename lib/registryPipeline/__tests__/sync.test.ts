import { describe, expect, it, vi } from 'vitest';
import { computePageSize, runSync, SYNC_PROGRESS_KEY } from '../sync';
import type { AcPort, DbPort } from '../ports';
import type { AcContactListMembership } from '../types';

// Real pacing delay (rateLimiter.ts's REQUEST_PACING_MS) stubbed to zero —
// several tests exercise many contacts/pages, which would otherwise take
// real seconds for no testing value.
vi.mock('../rateLimiter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rateLimiter')>();
  return { ...actual, sleep: vi.fn().mockResolvedValue(undefined) };
});

/**
 * `pages`: sequential pages returned by getContactsPage, one array call
 * per invocation (an empty array ends the sweep).
 * `membershipsByContact`: what getContactListMemberships returns for each
 * contact id — defaults to `[]` (no memberships at all) for any contact
 * not listed, matching a real contact that isn't on List 1 or List 2.
 */
function makeAc(config: {
  pages: { id: string }[][];
  membershipsByContact?: Record<string, AcContactListMembership[]>;
}): AcPort {
  let pageCallIndex = 0;
  return {
    getContactsPage: vi.fn(async () => {
      const page = config.pages[pageCallIndex] ?? [];
      pageCallIndex++;
      return page;
    }),
    getContactListMemberships: vi.fn(async (contactId: string) => config.membershipsByContact?.[contactId] ?? []),
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
  it('lands one staging event for a contact with a genuine, active List 1/2 membership, tagged backfill on the first-ever run', async () => {
    const membership: AcContactListMembership = { contact: 'ac-1', list: '1', status: '1' };
    const ac = makeAc({ pages: [[{ id: 'ac-1' }], []], membershipsByContact: { 'ac-1': [membership] } });
    const db = makeDb({ getLastCompletedSyncTimestamp: vi.fn().mockResolvedValue(null) });

    const result = await runSync(ac, db);

    expect(db.insertStagingEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sourceListId: '1', acContactId: 'ac-1', eventType: 'backfill' })
    );
    expect(result.recordsIn).toBe(1);
    expect(result.partial).toBe(false);
  });

  it('never fetches contact detail for a contact with no List 1/2 membership at all', async () => {
    // Replaces the old "never queries List 3/5" test now that discovery
    // is a single account-wide sweep rather than a per-list query: the
    // guarantee this pipeline makes is no longer "we never ask about that
    // list", it's "we never fetch a non-qualifying contact's field values
    // or tags" — see sync.ts's Sixth deviation.
    const ac = makeAc({ pages: [[{ id: 'ac-1' }], []], membershipsByContact: { 'ac-1': [] } });
    const db = makeDb();

    const result = await runSync(ac, db);

    expect(ac.getContactDetail).not.toHaveBeenCalled();
    expect(db.insertStagingEvent).not.toHaveBeenCalled();
    expect(result.recordsIn).toBe(0);
  });

  it('ignores a List 3/5 membership for a contact that also has a genuine List 1/2 one', async () => {
    // A contact can legitimately be on multiple lists. The excluded ones
    // must never be acted on even when they arrive alongside a genuine
    // qualifying membership for the same contact.
    const wanted: AcContactListMembership = { contact: 'ac-1', list: '1', status: '1' };
    const excluded: AcContactListMembership = { contact: 'ac-1', list: '3', status: '1' };
    const ac = makeAc({ pages: [[{ id: 'ac-1' }], []], membershipsByContact: { 'ac-1': [wanted, excluded] } });
    const db = makeDb();

    const result = await runSync(ac, db);

    expect(result.recordsIn).toBe(1);
    expect(db.insertStagingEvent).toHaveBeenCalledTimes(1);
    expect(db.insertStagingEvent).toHaveBeenCalledWith(expect.objectContaining({ sourceListId: '1' }));
  });

  it('discards a membership row whose own .contact does not match what was requested (defense-in-depth against a broken AC filter)', async () => {
    // filters[contact] on /contactLists is unverified (see acClient.ts's
    // getContactListMemberships) — every row is still checked against the
    // contact actually requested, same discipline already required for
    // this endpoint's list-scoping (confirmed broken there).
    const genuine: AcContactListMembership = { contact: 'ac-1', list: '1', status: '1' };
    const contamination: AcContactListMembership = { contact: 'ac-999', list: '1', status: '1' };
    const ac = makeAc({ pages: [[{ id: 'ac-1' }], []], membershipsByContact: { 'ac-1': [genuine, contamination] } });
    const db = makeDb();

    const result = await runSync(ac, db);

    expect(result.recordsIn).toBe(1);
    expect(db.insertStagingEvent).toHaveBeenCalledTimes(1);
    expect(db.insertStagingEvent).toHaveBeenCalledWith(expect.objectContaining({ acContactId: 'ac-1' }));
  });

  it('reuses a single detail fetch for a contact that qualifies under both List 1 and List 2', async () => {
    const onList1: AcContactListMembership = { contact: 'ac-1', list: '1', status: '1' };
    const onList2: AcContactListMembership = { contact: 'ac-1', list: '2', status: '1' };
    const ac = makeAc({ pages: [[{ id: 'ac-1' }], []], membershipsByContact: { 'ac-1': [onList1, onList2] } });
    const db = makeDb();

    const result = await runSync(ac, db);

    expect(ac.getContactDetail).toHaveBeenCalledTimes(1);
    expect(result.recordsIn).toBe(2);
    expect(db.insertStagingEvent).toHaveBeenCalledWith(expect.objectContaining({ sourceListId: '1' }));
    expect(db.insertStagingEvent).toHaveBeenCalledWith(expect.objectContaining({ sourceListId: '2' }));
  });

  it('skips the detail fetch and staging insert entirely for a membership whose status is not active', async () => {
    const inactive: AcContactListMembership = { contact: 'ac-1', list: '1', status: '3' };
    const active: AcContactListMembership = { contact: 'ac-2', list: '1', status: '1' };
    const ac = makeAc({
      pages: [[{ id: 'ac-1' }, { id: 'ac-2' }], []],
      membershipsByContact: { 'ac-1': [inactive], 'ac-2': [active] },
    });
    const db = makeDb();

    const result = await runSync(ac, db);

    // The inactive membership never reaches getContactDetail or staging at
    // all — not just discarded later by transform.ts.
    expect(ac.getContactDetail).toHaveBeenCalledTimes(1);
    expect(ac.getContactDetail).toHaveBeenCalledWith('ac-2');
    expect(ac.getContactDetail).not.toHaveBeenCalledWith('ac-1');
    expect(db.insertStagingEvent).toHaveBeenCalledTimes(1);
    expect(db.insertStagingEvent).toHaveBeenCalledWith(expect.objectContaining({ acContactId: 'ac-2' }));
    expect(result.recordsIn).toBe(1);
  });

  it('tags staging events as sync (not backfill) once a prior completed sync exists', async () => {
    const membership: AcContactListMembership = { contact: 'ac-1', list: '1', status: '1' };
    const ac = makeAc({ pages: [[{ id: 'ac-1' }], []], membershipsByContact: { 'ac-1': [membership] } });
    const db = makeDb({ getLastCompletedSyncTimestamp: vi.fn().mockResolvedValue('2026-08-01T00:00:00Z') });

    await runSync(ac, db);

    expect(db.insertStagingEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'sync' }));
    expect(ac.getContactsPage).toHaveBeenCalledWith(
      expect.objectContaining({ updatedSince: '2026-08-01T00:00:00Z' })
    );
  });

  it('passes updatedSince as null on the first-ever run', async () => {
    const ac = makeAc({ pages: [[]] });
    const db = makeDb({ getLastCompletedSyncTimestamp: vi.fn().mockResolvedValue(null) });

    await runSync(ac, db);

    expect(ac.getContactsPage).toHaveBeenCalledWith(expect.objectContaining({ updatedSince: null }));
  });

  it('paginates until an empty page is returned, then clears its progress', async () => {
    const m1: AcContactListMembership = { contact: 'ac-1', list: '2', status: '1' };
    const m2: AcContactListMembership = { contact: 'ac-2', list: '2', status: '1' };
    const ac = makeAc({
      pages: [[{ id: 'ac-1' }], [{ id: 'ac-2' }], []],
      membershipsByContact: { 'ac-1': [m1], 'ac-2': [m2] },
    });
    const db = makeDb();

    const result = await runSync(ac, db);

    expect(result.recordsIn).toBe(2);
    expect(db.clearSyncProgress).toHaveBeenCalledWith(SYNC_PROGRESS_KEY);
  });

  it('completes the sync log with counts from the transform step when a pass fully drains', async () => {
    const ac = makeAc({ pages: [[]] });
    const db = makeDb();

    const result = await runSync(ac, db);

    expect(db.completeSyncLog).toHaveBeenCalledWith(1, { recordsIn: 0, recordsUpserted: 0, errors: 0 });
    expect(db.recordPartialSync).not.toHaveBeenCalled();
    expect(result.partial).toBe(false);
  });

  it('fails the sync log and rethrows when the AC call throws', async () => {
    const ac: AcPort = {
      getContactsPage: vi.fn().mockRejectedValue(new Error('AC unreachable')),
      getContactListMemberships: vi.fn(),
      getContactDetail: vi.fn(),
    };
    const db = makeDb();

    await expect(runSync(ac, db)).rejects.toThrow('AC unreachable');
    expect(db.failSyncLog).toHaveBeenCalledWith(1, 'AC unreachable');
  });

  it('resumes from its previously saved offset rather than starting over', async () => {
    const ac = makeAc({ pages: [[]] });
    const db = makeDb({ getSyncProgress: vi.fn().mockResolvedValue(200) });

    await runSync(ac, db);

    expect(ac.getContactsPage).toHaveBeenCalledWith(expect.objectContaining({ offset: 200 }));
  });

  it('times out mid-page (not just between pages) and leaves the offset unadvanced for a clean resume', async () => {
    // Real invocation data (under the old per-list design) showed
    // wall-clock time running far past the nominal budget once a page
    // started processing with no deadline check. This proves the fix
    // still holds under the new single-sweep loop: a page with two
    // contacts, clock trips after the first.
    const m1: AcContactListMembership = { contact: 'ac-1', list: '1', status: '1' };
    const m2: AcContactListMembership = { contact: 'ac-2', list: '1', status: '1' };
    const ac = makeAc({ pages: [[{ id: 'ac-1' }, { id: 'ac-2' }]], membershipsByContact: { 'ac-1': [m1], 'ac-2': [m2] } });
    const db = makeDb();
    // Calls: acDeadline calc, loop-check (passes), per-contact check
    // before ac-1 (passes), per-contact check before ac-2 (trips — ac-2
    // never touched).
    const now = makeClock([0, 0, 0, 2000]);

    const result = await runSync(ac, db, { acBudgetMs: 1000, now });

    expect(result.recordsIn).toBe(1);
    expect(db.insertStagingEvent).toHaveBeenCalledTimes(1);
    expect(db.insertStagingEvent).toHaveBeenCalledWith(expect.objectContaining({ acContactId: 'ac-1' }));
    // Offset must never advance for a page that didn't finish — the next
    // invocation needs to re-fetch this exact page, not skip past it.
    expect(db.saveSyncProgress).not.toHaveBeenCalled();
    expect(result.partial).toBe(true);
  });

  it('still runs the transform step on whatever landed before a partial timeout', async () => {
    const ac = makeAc({ pages: [[{ id: 'ac-1' }]], membershipsByContact: { 'ac-1': [{ contact: 'ac-1', list: '1', status: '1' }] } });
    const db = makeDb();
    const now = makeClock([0, 0, 2000]);

    await runSync(ac, db, { acBudgetMs: 1000, now });

    expect(db.getPendingStagingEvents).toHaveBeenCalled();
  });

  it('gives the transform phase its own fresh budget rather than whatever is left of the AC-pull one', async () => {
    // AC-pull drains instantly (no work), so it never times out — but the
    // transform phase itself reports partial (e.g. a large backlog).
    const ac = makeAc({ pages: [[]] });
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
    // now() sequence: acDeadline calc + one loop check (empty page, sweep
    // ends immediately -> 2 calls), then transformDeadline calc, then one
    // check per pending event inside transform (3 events) — the last of
    // which trips, leaving the 3rd event unprocessed.
    const now = makeClock([0, 0, 0, 0, 0, 5000]);

    const result = await runSync(ac, db, { acBudgetMs: 1000, transformBudgetMs: 1000, now });

    expect(result.partial).toBe(true);
    expect(result.recordsUpserted).toBe(2);
    expect(db.recordPartialSync).toHaveBeenCalledWith(1, { recordsIn: 0, recordsUpserted: 2, errors: 0 });
    expect(db.completeSyncLog).not.toHaveBeenCalled();
  });

  it('requests a page size scaled to the full AC-pull budget (no longer split across separate lists)', async () => {
    // Real incident (2026-08-31): a fixed page size of 100 could never
    // finish within a tightened budget, so the pagination offset could
    // never advance — a silent, permanent stall. Every invocation must
    // request a page it can actually finish. Also verifies the budget is
    // no longer divided by a list count (there's only one sweep now): a
    // 4000ms budget yields pageSize 2, not 1 (which is what the old
    // per-list-split design would have produced for this same input).
    const ac = makeAc({ pages: [[]] });
    const db = makeDb();

    await runSync(ac, db, { acBudgetMs: 4000 });

    expect(ac.getContactsPage).toHaveBeenCalledWith(expect.objectContaining({ limit: 2 }));
  });
});

describe('computePageSize', () => {
  it('never exceeds the AC maximum of 100, even with a huge budget', () => {
    expect(computePageSize(10_000_000)).toBe(100);
  });

  it('scales down with a smaller budget', () => {
    expect(computePageSize(32_500)).toBe(16);
  });

  it('never returns less than 1, even with a near-zero budget', () => {
    expect(computePageSize(1)).toBe(1);
    expect(computePageSize(0)).toBe(1);
  });

  it('scales up with a larger budget, up to the AC maximum', () => {
    expect(computePageSize(60_000)).toBe(30);
  });
});
