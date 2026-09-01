// Scheduled sync step of the registry pipeline (backfill + ongoing, one
// function). See docs/registry-pipeline/AFJ_PII_Technical_Implementation_Plan.md
// Section 6.1 and docs/registry-pipeline/FORWARD_SYNC_REDESIGN.md.
//
// Deliberate deviation from the plan's pseudocode, noted here since the
// plan itself flags it as an open question (Section 6.1's last note): the
// plan's `AC.getContacts()` pulls a single global contact stream and skips
// `contact.list_id not in ['1','2']` client-side. This implementation's
// history went through several distinct designs before landing on that
// same shape the plan originally proposed — the numbered deviations below
// are kept as a record of why, in the order they happened.
//
// First deliberate deviation (superseded — see Sixth, below): the
// original build queried List 1 and List 2 *separately* via a
// `/contactLists`-scoped `AcPort.getContactListPage`, intended to be
// scoped to one list by AC's own list filter.
//
// UPDATE — that intent held up until real invocation data proved AC's
// server-side filter wasn't actually being honored (see the Fourth
// deviation below): a List-3/5 contact's data WAS fetched and landed in
// staging, and some of it reached the registry, before this was caught.
//
// Second deliberate deviation, added after two real manual invocations
// against live AC data each hit a different platform ceiling mid-run
// (first a ~150s gateway idle timeout mid-AC-pull, then a hard
// WORKER_RESOURCE_LIMIT once the AC-pull phase was budgeted but the
// transform phase — processing a ~180-row backlog with a couple of
// sequential DB round-trips each — was not): both phases now run under
// their OWN time budget, one after the other, each measured from when
// that phase starts (not a single shared deadline — that would let a slow
// AC-pull phase starve transform of any time at all). The incremental
// timestamp cursor (sync_log.completed_at, later status='success' — see
// Fifth deviation) only advances once BOTH phases fully drain in the same
// invocation, never on a partial run — see recordPartialSync's doc
// comment in ports.ts.
//
// Third deliberate deviation (superseded — see Sixth, below): while
// discovery was still per-list, List 1 turned out to hold ~14,000
// distinct contacts, so it never once finished within its slice of the
// AC-pull budget across ~200 real invocations, starving List 2 entirely
// under the original "break out of both lists the moment either times
// out" loop. Each list was given its own fair slice of the AC budget as
// a fix — moot now that discovery is a single unified sweep, not two
// per-list passes.
//
// Fourth deliberate deviation — a real data-governance incident, not just
// a tuning issue: reconciling landed data against a ground-truth
// spreadsheet surfaced that AC's `/contactLists` filter (`filters[list]`,
// then `filters[listid]`) was not filtering at all — confirmed via real
// invocation data (342 List-3 and 5 List-5 memberships landed in
// staging.ac_events despite every query being for List 1 or List 2; 114
// had already reached registry.registrants/registration_events before
// this was caught — Lists 3/5 are permanently excluded, plan Section
// 3.6, List 5 specifically because it contains sensitive financial-intent
// data that "should never be one accidental query away from entering the
// registry", plan Section 6.1). Every returned membership row is checked
// against the contact/list it's supposed to belong to before it's allowed
// anywhere near staging — not just a policy decision, enforced in code —
// and that defense-in-depth check is still load-bearing today (see the
// Sixth deviation's membership lookup, below). See
// docs/registry-pipeline/OPERATIONS.md for the cleanup this required for
// data already landed before the fix.
//
// Fifth deviation: registry.sync_log.status added (success/partial/
// failed/crashed) — getLastCompletedSyncTimestamp() previously used
// `completed_at IS NOT NULL` as its proxy for "trustworthy cursor
// source", but a FAILED run also sets completed_at, so a failed run's
// timestamp could masquerade as a genuine completion. See
// scripts/add_status_to_sync_log.sql and OPERATIONS.md.
//
// Sixth deliberate deviation — the current design, replacing per-list
// `/contactLists` pagination entirely: reconciling against a ground-truth
// spreadsheet (2026-09-01) surfaced that discovery itself wasn't
// reliable — `staging.ac_events`'s full history showed only 14,078
// distinct contacts behind List 1's 40,678 fetches (some individual
// contacts re-fetched 300+ times), and registry.registrants had
// essentially zero growth for four days despite continuous
// "successful" invocations. Root cause: `/contactLists`'s offset-based
// pagination assumes a stable result-set ordering across repeated calls,
// and every `filters[...]` param tried on that endpoint
// (`list`/`listid`/`updated_since`) was already confirmed broken — there
// was no remaining reason to trust its ordering either. Replaced with a
// single account-wide sweep of `/contacts`, ordered by the contact's own
// immutable, monotonically increasing id — confirmed via a live probe
// (docs/registry-pipeline/OPERATIONS.md, 2026-09-01) to be genuinely
// stable (the same page fetched twice, 8s apart, returned identical
// contacts in identical order), with `filters[updated_after]` confirmed
// to actually filter (the first AC filter of any kind, on any endpoint,
// in this project to pass a live future-dated test) — making incremental
// syncs genuinely incremental instead of full-account rescans. Because
// `/contacts` doesn't embed list membership (confirmed via the same
// probe), each contact still gets a scoped `AcPort.getContactListMemberships`
// lookup — but only ever for a contact discovered via this sweep, so a
// contact that's never on List 1 or List 2 never has its field values or
// tags fetched, preserving the existing privacy posture for Lists 3/5.
// See docs/registry-pipeline/FORWARD_SYNC_REDESIGN.md for the full design
// and the options considered.

import { getErrorMessage } from '../errorUtils.ts';
import { isActiveListStatus } from './listFilter.ts';
import { REQUEST_PACING_MS, sleep } from './rateLimiter.ts';
import type { AcPort, DbPort } from './ports.ts';
import { transformPendingStagingEvents } from './transform.ts';

/** AC lists a discovered contact's memberships are checked against. Anything else (including 3/5) is never acted on — see plan Section 3.6/6.1. */
const SYNCED_LIST_IDS: readonly string[] = ['1', '2'];

/** Sentinel key for the single account-wide sweep's persisted pagination progress (see ports.ts's getSyncProgress doc comment). */
export const SYNC_PROGRESS_KEY = 'contacts';

const MAX_PAGE_SIZE = 100; // AC paginates at 100/request max (plan Section 6.1)

/**
 * Conservative estimate of wall-clock cost per contact returned by the
 * `/contacts` sweep — one membership lookup, plus (only for a contact
 * that turns out to qualify for List 1/2) one getContactDetail call, each
 * with its own pacing sleep. Deliberately unchanged from the old
 * per-list design's estimate (which assumed a full detail fetch for
 * every page entry) even though most contacts in a full backfill sweep
 * won't qualify and will cost less — safe (conservative) rather than
 * re-tuned ahead of live data confirming the new steady-state cost; a
 * candidate for a future, evidence-based reduction, not a correctness
 * concern either way.
 */
const ESTIMATED_MS_PER_CONTACT = 1000;

/**
 * How many contacts to request per page, sized so a FULL page can actually
 * finish within budget — not just capped at AC's own 100/request maximum.
 *
 * Real incident (2026-08-31): PAGE_SIZE was a fixed 100 while the AC-pull
 * budget was tightened. A full 100-contact page takes far longer to
 * process than either budget allowed — and since a page that times out
 * mid-way leaves the pagination offset unadvanced by design (so the next
 * invocation resumes rather than skipping unprocessed contacts), a page
 * that can never fully complete within budget meant the offset could
 * NEVER advance: a self-inflicted infinite loop on the very first page
 * that needed close to a full traversal. Sizing the page to the budget,
 * not the other way around, makes this whole class of bug structurally
 * impossible regardless of future budget tuning.
 */
export function computePageSize(budgetMs: number): number {
  const budgetForOnePage = budgetMs * 0.5;
  const size = Math.floor(budgetForOnePage / ESTIMATED_MS_PER_CONTACT);
  return Math.max(1, Math.min(MAX_PAGE_SIZE, size));
}

/**
 * How long the AC-pulling phase and the transform phase are each allowed to
 * run before stopping and leaving the rest for the next invocation. See
 * the file header's Second deviation for why they're separate budgets.
 * 65s/65s (130s nominal) settled on comfortably under the ~150s gateway
 * idle-connection timeout observed on this project's Supabase plan, with
 * real margin. The per-contact deadline check remains the real safety
 * net regardless of this nominal value. Overridable per-call for further
 * tuning without a code change.
 */
export const DEFAULT_AC_BUDGET_MS = 65_000;
export const DEFAULT_TRANSFORM_BUDGET_MS = 65_000;

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
    let skippedInactive = 0;
    let anyTimedOut = false;

    const acDeadline = now() + acBudgetMs;
    const pageSize = computePageSize(acBudgetMs);

    let offset = (await db.getSyncProgress(SYNC_PROGRESS_KEY)) ?? 0;

    for (;;) {
      if (now() >= acDeadline) {
        anyTimedOut = true;
        break;
      }

      const page = await ac.getContactsPage({ updatedSince: lastSync, limit: pageSize, offset });
      if (page.length === 0) {
        await db.clearSyncProgress(SYNC_PROGRESS_KEY);
        break;
      }

      let timedOutMidPage = false;
      for (const contact of page) {
        if (now() >= acDeadline) {
          timedOutMidPage = true;
          anyTimedOut = true;
          break;
        }

        // Cheap membership lookup first — the expensive detail fetch
        // (fieldValues + tags, potentially sensitive) only ever happens
        // for a contact that turns out to genuinely qualify below. A
        // contact that's never on List 1 or List 2 never has its detail
        // fetched at all, same privacy posture as the old per-list design
        // (see the Sixth deviation above).
        const rawMemberships = await ac.getContactListMemberships(contact.id);
        await sleep(REQUEST_PACING_MS);

        // Defense-in-depth: never trust a returned row's own `.contact`
        // blindly (see the Fourth deviation above — this is the same
        // discipline, just applied per-contact now instead of per-list).
        const ownMemberships = rawMemberships.filter((m) => m.contact === contact.id);
        const qualifying = ownMemberships.filter((m) => SYNCED_LIST_IDS.includes(m.list));

        if (qualifying.length === 0) {
          continue;
        }

        // Split active from inactive here (not just left to transform.ts)
        // for the same reason as the list-status skip fixed 2026-09-01:
        // membership.status is already in hand from the cheap lookup
        // above, so an inactive membership never triggers the detail
        // fetch below at all, rather than being fetched in full and
        // discarded at transform time.
        const activeQualifying = qualifying.filter((m) => isActiveListStatus(m.status));
        skippedInactive += qualifying.length - activeQualifying.length;
        if (activeQualifying.length === 0) {
          continue;
        }

        // One detail fetch per contact, reused for every list it
        // qualifies under (a contact on both List 1 and List 2 no longer
        // pays for two separate detail fetches, unlike the old per-list
        // design that would query each list's pagination independently).
        const detail = await ac.getContactDetail(contact.id);
        await sleep(REQUEST_PACING_MS);

        for (const membership of activeQualifying) {
          await db.insertStagingEvent({
            sourceListId: membership.list,
            acContactId: contact.id,
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
      }

      if (timedOutMidPage) break;

      offset += page.length;
      await db.saveSyncProgress(SYNC_PROGRESS_KEY, offset);
      await sleep(REQUEST_PACING_MS);
    }

    if (skippedInactive > 0) {
      console.log(`runSync: skipped ${skippedInactive} inactive membership(s) without a detail fetch`);
    }

    // Transform whatever has landed so far regardless of whether the
    // AC-pull phase fully drained — no reason to leave already-synced
    // staging rows unprocessed just because the sweep ran out of time.
    // Gets its own fresh budget, not whatever's left of the AC-pull one,
    // so a slow AC-pull phase can't starve it entirely.
    const transformDeadline = now() + transformBudgetMs;
    const { recordsUpserted, errors, partial: transformPartial } = await transformPendingStagingEvents(db, {
      deadline: transformDeadline,
      now,
    });

    const partial = anyTimedOut || transformPartial;

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
