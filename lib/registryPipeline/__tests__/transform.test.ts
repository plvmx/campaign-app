import { describe, expect, it, vi } from 'vitest';
import { transformPendingStagingEvents } from '../transform';
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
  };
}

describe('transformPendingStagingEvents', () => {
  it('upserts a registrant and records a registration event for an active submission', async () => {
    const db = makeDb([makeEvent(1)]);
    const result = await transformPendingStagingEvents(db);

    expect(result).toEqual({ recordsUpserted: 1, errors: 0 });
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

    expect(result).toEqual({ recordsUpserted: 0, errors: 0 });
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

    expect(result).toEqual({ recordsUpserted: 1, errors: 1 });
    expect(db.markStagingError).toHaveBeenCalledWith(4, 'db unavailable');
    expect(db.markStagingProcessed).toHaveBeenCalledWith(5, null);
  });
});
