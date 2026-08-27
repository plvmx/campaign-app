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
//
// Second deliberate deviation, added after two real manual invocations
// against live AC data each hit a different platform ceiling mid-run
// (first a ~150s gateway idle timeout mid-AC-pull, then a hard
// WORKER_RESOURCE_LIMIT once the AC-pull phase was budgeted but the
// transform phase — processing a ~180-row backlog with a couple of
// sequential DB round-trips each — was not): both phases now run under
// their OWN time budget, one after the other, each measured from when
// that phase starts (not a single shared deadline — that would let a slow
// AC-pull phase starve transform of any time at all). The AC-pull phase
// persists a resumable per-list pagination offset
// (DbPort.getSyncProgress/saveSyncProgress/clearSyncProgress); the
// transform phase needs no separate cursor, since a staging row is only
// ever marked done once its own work actually completes (see
// transform.ts). The incremental timestamp cursor (sync_log.completed_at)
// only advances once BOTH phases fully drain in the same invocation,
// never on a partial run — see recordPartialSync's doc comment in ports.ts.

import { getErrorMessage } from '../errorUtils.ts';
import { REQUEST_PACING_MS, sleep } from './rateLimiter.ts';
import type { AcPort, DbPort } from './ports.ts';
import { transformPendingStagingEvents } from './transform.ts';

/** AC lists that are ever polled. Lists 3 and 5 are never queried — see plan Section 3.6/6.1. */
const SYNCED_LIST_IDS = ['1', '2'] as const;

const PAGE_SIZE = 100; // AC paginates at 100/request max (plan Section 6.1)

/**
 * How long the AC-pulling phase and the transform phase are each allowed to
 * run before stopping and leaving the rest for the next invocation. Chosen
 * so the two phases' worst-case combined wall time stays comfortably under
 * both platform ceilings observed against a real invocation (a ~150s
 * gateway idle timeout, and a separate hard WORKER_RESOURCE_LIMIT).
 * Overridable per-call for tuning without a code change once real contact
 * volume is known.
 */
export const DEFAULT_AC_BUDGET_MS = 60_000;
export const DEFAULT_TRANSFORM_BUDGET_MS = 60_000;

export interface SyncResult {
  recordsIn: number;
  recordsUpserted: number;
  errors: number;
  /** True if either phase ran out of its time budget (or the transform backlog exceeded one batch) before fully draining — call runSync again to continue. */
  partial: boolean;
}

export interface RunSyncOptions {
  acBudgetMs?: number;
  transformBudgetMs?: number;
  /** Injectable clock, defaulting to Date.now — lets tests control elapsed time deterministically without real timers. */
  now?: () => number;
}

export async function runSync(ac: AcPort, db: DbPort, options: RunSyncOptions = {}): Promise<SyncResult> {
  const acBudgetMs = options.acBudgetMs ?? DEFAULT_AC_BUDGET_MS;
  const transformBudgetMs = options.transformBudgetMs ?? DEFAULT_TRANSFORM_BUDGET_MS;
  const now = options.now ?? Date.now;

  const logId = await db.startSyncLog();

  try {
    const lastSync = await db.getLastCompletedSyncTimestamp();
    const eventType: 'backfill' | 'sync' = lastSync === null ? 'backfill' : 'sync';
    let recordsIn = 0;
    let acTimedOut = false;

    const acDeadline = now() + acBudgetMs;

    for (const listId of SYNCED_LIST_IDS) {
      let offset = (await db.getSyncProgress(listId)) ?? 0;

      for (;;) {
        if (now() >= acDeadline) {
          acTimedOut = true;
          break;
        }

        const page = await ac.getContactListPage({ listId, updatedSince: lastSync, limit: PAGE_SIZE, offset });
        if (page.length === 0) {
          await db.clearSyncProgress(listId);
          break;
        }

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
        await db.saveSyncProgress(listId, offset);
        await sleep(REQUEST_PACING_MS);
      }

      if (acTimedOut) break;
    }

    // Transform whatever has landed so far regardless of whether the
    // AC-pull phase fully drained every list — no reason to leave
    // already-synced staging rows unprocessed just because a later list
    // ran out of time. Gets its own fresh budget, not whatever's left of
    // the AC-pull one, so a slow AC-pull phase can't starve it entirely.
    const transformDeadline = now() + transformBudgetMs;
    const { recordsUpserted, errors, partial: transformPartial } = await transformPendingStagingEvents(db, {
      deadline: transformDeadline,
      now,
    });

    const partial = acTimedOut || transformPartial;

    if (partial) {
      await db.recordPartialSync(logId, { recordsIn, recordsUpserted, errors });
    } else {
      await db.completeSyncLog(logId, { recordsIn, recordsUpserted, errors });
    }
    return { recordsIn, recordsUpserted, errors, partial };
  } catch (err) {
    await db.failSyncLog(logId, getErrorMessage(err));
    throw err;
  }
}
