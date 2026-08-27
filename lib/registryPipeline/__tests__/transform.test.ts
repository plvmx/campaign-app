import { describe, expect, it, vi } from 'vitest';
import { TRANSFORM_BATCH_LIMIT, transformPendingStagingEvents } from '../transform';
import type { DbPort, StagingEventRow } from '../ports';
import type { KnownSourceTag, RawAcContactPayload } from '../types';

const KNOWN_TAGS: KnownSourceTag[] = [
  { ac_tag_id: '48', tag_name: 'CAMPAIGN: TWOL Sept 2019 Register', source_label: 'wayoflife_interest' },
];

function makeEvent(id: number, overrides: Partial<RawAcContactPayload> = {}): StagingEventRow {
  return {
    id,
    raw_payload: {
      contact: { id: `ac-${id}`, email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe', phone: '0438438438' },
      fieldValues: [{ field: '6', value: 'NSW' }],
      tags: [{ id: '48' }],
      listMembership: { contact: `ac-${id}`, list: '1', status: '1' },
      ...overrides,
    },
  };
}

function makeDb(events: StagingEventRow[]): DbPort {
  return {
    startSyncLog: vi.fn(),
    getLastCompletedSyncTimestamp: vi.fn(),
    insertStagingEvent: vi.fn(),
    completeSyncLog: vi.fn(),
    failSyncLog: vi.fn(),
    getPendingStagingEvents: vi.fn().mockResolvedValue(events),
    getKnownSourceTags: vi.fn().mockResolvedValue(KNOWN_TAGS),
    upsertRegistrant: vi.fn().mockResolvedValue({ id: 'registrant-1' }),
    insertRegistrationEvent: vi.fn().mockResolvedValue(undefined),
    markStagingProcessed: vi.fn().mockResolvedValue(undefined),
    markStagingError: vi.fn().mockResolvedValue(undefined),
    getSyncProgress: vi.fn().mockResolvedValue(null),
    saveSyncProgress: vi.fn().mockResolvedValue(undefined),
    clearSyncProgress: vi.fn().mockResolvedValue(undefined),
    recordPartialSync: vi.fn().mockResolvedValue(undefined),
  };
}

describe('transformPendingStagingEvents', () => {
  it('upserts a registrant and records a registration event for an active submission', async () => {
    const db = makeDb([makeEvent(1)]);
    const result = await transformPendingStagingEvents(db);

    expect(result).toEqual({ recordsUpserted: 1, errors: 0, partial: false });
    expect(db.upsertRegistrant).toHaveBeenCalledWith({
      acContactId: 'ac-1',
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+61438438438',
      phoneRaw: '0438438438',
      state: 'NSW',
    });
    expect(db.insertRegistrationEvent).toHaveBeenCalledWith({
      registrantId: 'registrant-1',
      sourceListId: '1',
      sourceTag: 'CAMPAIGN: TWOL Sept 2019 Register',
      eventType: 'new_registration',
      rawStagingId: 1,
    });
    expect(db.markStagingProcessed).toHaveBeenCalledWith(1, null);
  });

  it('skips a submission whose list status is not active, without touching registrants', async () => {
    const db = makeDb([makeEvent(2, { listMembership: { contact: 'ac-2', list: '1', status: '3' } })]);
    const result = await transformPendingStagingEvents(db);

    expect(result).toEqual({ recordsUpserted: 0, errors: 0, partial: false });
    expect(db.upsertRegistrant).not.toHaveBeenCalled();
    expect(db.markStagingProcessed).toHaveBeenCalledWith(2, 'skipped: list status not active');
  });

  it('records a null source_tag when no known tag matches', async () => {
    const db = makeDb([makeEvent(3, { tags: [{ id: '999' }] })]);
    await transformPendingStagingEvents(db);

    expect(db.insertRegistrationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sourceTag: null })
    );
  });

  it('marks a staging row errored and continues processing subsequent events', async () => {
    const db = makeDb([makeEvent(4), makeEvent(5)]);
    (db.upsertRegistrant as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db unavailable'));

    const result = await transformPendingStagingEvents(db);

    expect(result).toEqual({ recordsUpserted: 1, errors: 1, partial: false });
    expect(db.markStagingError).toHaveBeenCalledWith(4, 'db unavailable');
    expect(db.markStagingProcessed).toHaveBeenCalledWith(5, null);
  });

  it('passes the batch limit through to getPendingStagingEvents', async () => {
    const db = makeDb([]);
    await transformPendingStagingEvents(db);

    expect(db.getPendingStagingEvents).toHaveBeenCalledWith(TRANSFORM_BATCH_LIMIT);
  });

  it('reports partial and leaves later rows untouched once the deadline passes', async () => {
    const db = makeDb([makeEvent(1), makeEvent(2), makeEvent(3)]);
    let calls = 0;
    const now = () => {
      calls++;
      // First two checks (before events 1 and 2) pass; the third (before event 3) trips.
      return calls < 3 ? 0 : 1000;
    };

    const result = await transformPendingStagingEvents(db, { deadline: 1000, now });

    expect(result).toEqual({ recordsUpserted: 2, errors: 0, partial: true });
    expect(db.markStagingProcessed).toHaveBeenCalledWith(1, null);
    expect(db.markStagingProcessed).toHaveBeenCalledWith(2, null);
    expect(db.markStagingProcessed).not.toHaveBeenCalledWith(3, null);
  });

  it('reports partial when a full batch is returned, even without hitting the time budget', async () => {
    const fullBatch = Array.from({ length: TRANSFORM_BATCH_LIMIT }, (_, i) => makeEvent(i + 1));
    const db = makeDb(fullBatch);

    const result = await transformPendingStagingEvents(db);

    expect(result.partial).toBe(true);
    expect(result.recordsUpserted).toBe(TRANSFORM_BATCH_LIMIT);
  });

  it('does not report partial when fewer than a full batch is returned and nothing timed out', async () => {
    const db = makeDb([makeEvent(1)]);
    const result = await transformPendingStagingEvents(db);

    expect(result.partial).toBe(false);
  });
});
