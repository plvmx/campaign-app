// Scheduled sync step of the registry pipeline (backfill + ongoing, one
// function). See docs/registry-pipeline/AFJ_PII_Technical_Implementation_Plan.md
// Section 6.1.
//
// Deliberate deviation from the plan's pseudocode, noted here since the
// plan itself flags it as an open question (Section 6.1's last note): the
// plan's `AC.getContacts()` pulls a single global contact stream and skips
// `contact.list_id not in ['1','2']` client-side. This implementation
// instead queries List 1 and List 2 *separately* via `AcPort.getContactListPage`
// (each call already scoped to one list by AC's own `listid` filter), so a
// List-3/5 contact's data is never fetched or seen in the first place —
// not filtered out after the fact. This directly answers the plan's open
// question about multi-list contacts: a contact on both List 1 and List 3
// simply appears once from the List-1 query (wanted) and never from a
// List-3 query (never issued), rather than needing to pick apart a merged
// multi-list payload.

import { getErrorMessage } from '../errorUtils.ts';
import { REQUEST_PACING_MS, sleep } from './rateLimiter.ts';
import type { AcPort, DbPort } from './ports.ts';
import { transformPendingStagingEvents } from './transform.ts';

/** AC lists that are ever polled. Lists 3 and 5 are never queried — see plan Section 3.6/6.1. */
const SYNCED_LIST_IDS = ['1', '2'] as const;

const PAGE_SIZE = 100; // AC paginates at 100/request max (plan Section 6.1)

export interface SyncResult {
  recordsIn: number;
  recordsUpserted: number;
  errors: number;
}

export async function runSync(ac: AcPort, db: DbPort): Promise<SyncResult> {
  const logId = await db.startSyncLog();

  try {
    const lastSync = await db.getLastCompletedSyncTimestamp();
    const eventType: 'backfill' | 'sync' = lastSync === null ? 'backfill' : 'sync';
    let recordsIn = 0;

    for (const listId of SYNCED_LIST_IDS) {
      let offset = 0;
      for (;;) {
        const page = await ac.getContactListPage({ listId, updatedSince: lastSync, limit: PAGE_SIZE, offset });
        if (page.length === 0) break;

        for (const membership of page) {
          const detail = await ac.getContactDetail(membership.contact);
          await sleep(REQUEST_PACING_MS);

          await db.insertStagingEvent({
            sourceListId: listId,
            acContactId: membership.contact,
            eventType,
            rawPayload: {
              contact: detail.core,
              fieldValues: detail.fieldValues,
              tags: detail.tags,
              listMembership: membership,
            },
          });
          recordsIn++;
        }

        offset += page.length;
        await sleep(REQUEST_PACING_MS);
      }
    }

    const { recordsUpserted, errors } = await transformPendingStagingEvents(db);
    await db.completeSyncLog(logId, { recordsIn, recordsUpserted, errors });
    return { recordsIn, recordsUpserted, errors };
  } catch (err) {
    await db.failSyncLog(logId, getErrorMessage(err));
    throw err;
  }
}
