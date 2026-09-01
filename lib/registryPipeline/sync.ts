// Scheduled sync step of the registry pipeline (backfill + ongoing, one
// function). See docs/registry-pipeline/AFJ_PII_Technical_Implementation_Plan.md
// Section 6.1.
//
// Deliberate deviation from the plan's pseudocode, noted here since the
// plan itself flags it as an open question (Section 6.1's last note): the
// plan's `AC.getContacts()` pulls a single global contact stream and skips
// `contact.list_id not in ['1','2']` client-side. This implementation
// instead queries List 1 and List 2 *separately* via `AcPort.getContactListPage`,
// intended to be scoped to one list by AC's own list filter. This directly
// answers the plan's open question about multi-list contacts: a contact on
// both List 1 and List 3 is meant to appear once from the List-1 query
// (wanted) and never from a List-3 query (never issued).
//
// UPDATE — that intent held up until real invocation data proved AC's
// server-side filter wasn't actually being honored (see the fourth
// deviation below): a List-3/5 contact's data WAS fetched and landed in
// staging, and some of it reached the registry, before this was caught.
// "Never fetched in the first place" is therefore no longer a safe claim
// to rely on by itself — the defense-in-depth filter below is now load-
// bearing, not merely a nice-to-have.
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
//
// Third deliberate deviation, found via real invocation data: List 1
// turned out to hold ~14,000 distinct contacts (a large historical
// catch-all list — see plan Section 3.3), so it never once finished
// within its slice of the AC-pull budget across ~200 real invocations.
// The original loop broke out of BOTH lists the moment ANY list ran out
// of time, so List 2 — a completely different, much smaller list — was
// starved entirely: it was never revisited again after the very first
// invocation. Each list now gets its own fair slice of acBudgetMs (split
// evenly across SYNCED_LIST_IDS) within a single invocation, so a large
// List 1 can no longer prevent List 2 from ever being touched.
//
// Fourth deliberate deviation — a real data-governance incident, not just
// a tuning issue: reconciling landed data against a ground-truth
// spreadsheet surfaced that AC's `/contactLists` filter (`filters[list]`,
// acClient.ts) was not filtering at all. Across ~200 real invocations,
// 342 List-3 and 5 List-5 memberships landed in staging.ac_events despite
// every query being for List 1 or List 2 — Lists 3/5 are supposed to be
// permanently excluded (plan Section 3.6), List 5 specifically because it
// contains sensitive financial-intent data that "should never be one
// accidental query away from entering the registry" (plan Section 6.1).
// 114 of those had already reached registry.registrants/registration_events
// via transform before this was caught. acClient.ts's filter parameter was
// corrected, AND — since that alone depends on trusting AC's API to behave
// as documented, exactly the assumption that just failed — every returned
// membership row is now checked against the listId actually requested
// before it's allowed anywhere near staging (see the `rawPage.filter(...)`
// below). See docs/registry-pipeline/OPERATIONS.md for the cleanup this
// required for data already landed before the fix.

import { getErrorMessage } from '../errorUtils.ts';
import { REQUEST_PACING_MS, sleep } from './rateLimiter.ts';
import type { AcPort, DbPort } from './ports.ts';
import { transformPendingStagingEvents } from './transform.ts';

/** AC lists that are ever polled. Lists 3 and 5 are never queried — see plan Section 3.6/6.1. */
const SYNCED_LIST_IDS = ['1', '2'] as const;

const MAX_PAGE_SIZE = 100; // AC paginates at 100/request max (plan Section 6.1)

/**
 * Conservative estimate of wall-clock cost per contact within a page (one
 * getContactDetail call + its pacing sleep + one staging insert). Rounded
 * up from ~850-900ms observed against real AC data. Used only to size
 * pages safely — see computePageSize below.
 */
const ESTIMATED_MS_PER_CONTACT = 1000;

/**
 * How many contacts to request per page, sized so a FULL page can actually
 * finish within budget — not just capped at AC's own 100/request maximum.
 *
 * Real incident (2026-08-31): PAGE_SIZE was a fixed 100 while the AC-pull
 * budget was tightened to 25s, then 65s, per list. A full 100-contact page
 * takes ~85-100s to process (confirmed from real timestamps) — MORE than
 * either budget. Since a page that times out mid-way leaves the pagination
 * offset unadvanced by design (so the next invocation resumes rather than
 * skipping unprocessed contacts — the correct behavior in isolation), a
 * page that can never fully complete within budget means the offset can
 * NEVER advance: a self-inflicted infinite loop on the very first page
 * that needs close to a full traversal. It ran for two days, silently,
 * because every individual invocation still reported apparent success
 * (nonzero recordsIn, no errors) — only the count of *distinct* contacts
 * actually landing gave it away (one contact ID reappeared 71 times in
 * staging.ac_events, spanning the entire supposedly-productive Pro-tier
 * batch run).
 *
 * Sizing the page to the budget, not the other way around, makes this
 * whole class of bug structurally impossible regardless of future budget
 * tuning: half of one list's budget is allotted to fully processing one
 * page, leaving the other half as margin for the page-listing call itself,
 * network/DB latency variance, and the next page's deadline check.
 */
export function computePageSize(perListBudgetMs: number): number {
  const budgetForOnePage = perListBudgetMs * 0.5;
  const size = Math.floor(budgetForOnePage / ESTIMATED_MS_PER_CONTACT);
  return Math.max(1, Math.min(MAX_PAGE_SIZE, size));
}

/**
 * How many consecutive pages with zero genuine (post-filter) matches
 * before a list is treated as exhausted, even without AC ever returning a
 * literal empty page. See the real incident documented where this check
 * is applied, in the main loop below. Deliberately generous — a false
 * "exhausted" conclusion would silently stop discovering a list's
 * remaining genuine members, a correctness regression; a page with zero
 * matches costs only one cheap list-listing call (no per-contact detail
 * fetches), so even 50 in a row comfortably fits within one invocation's
 * per-list budget once a list really is exhausted.
 */
export const MAX_CONSECUTIVE_EMPTY_MATCH_PAGES = 50;

/**
 * Authoritative AC list sizes, from a live ac_discovery.js run
 * (2026-08-29) — see docs/registry-pipeline/OPERATIONS.md. Used only as a
 * generous safety-valve cap (MAX_OFFSET_MULTIPLIER below), never to gate
 * normal operation — these will drift as AFJ's real registrant base
 * grows, and are deliberately multiplied by a wide margin rather than
 * treated as exact.
 */
export const KNOWN_LIST_SIZES: Readonly<Record<string, number>> = {
  '1': 10_454,
  '2': 4_204,
};

/**
 * Second, independent safety net alongside MAX_CONSECUTIVE_EMPTY_MATCH_PAGES
 * — real data showed the consecutive-streak heuristic alone wasn't enough:
 * List 2 kept climbing past 13,000 (true size ~4,204) because sparse,
 * already-known genuine matches kept resetting the streak just before it
 * reached the threshold, without representing any real new content (a
 * "genuine match" only means the row's own `.list` equals what was
 * requested — nothing about whether it's a contact already discovered
 * many times before). Once a list's offset exceeds this many times its
 * known true size, treat it as exhausted unconditionally, regardless of
 * recent match activity.
 */
export const MAX_OFFSET_MULTIPLIER = 3;

/**
 * How long the AC-pulling phase and the transform phase are each allowed to
 * run before stopping and leaving the rest for the next invocation.
 *
 * History on the Free plan: 60s/60s hit occasional resource-limit kills;
 * 40s/40s hit them more consistently once the per-list fair-slicing fix
 * meant every invocation reliably does more total work; settled at 25s/25s
 * for real stability, confirmed by 100+ consecutive clean invocations —
 * but confirmed via Supabase's own dashboard logs (cpu_time_used near
 * zero across a ~150s invocation) that this was a wall-clock execution
 * ceiling, not compute exhaustion, and specific to the Free plan.
 *
 * Tried 100s/100s (200s nominal) right after upgrading to Pro (2026-08-31)
 * — still hit `IDLE_TIMEOUT` at exactly 150s. That's decisive: the ~150s
 * limit is a separate, fixed gateway/HTTP idle-connection timeout, not the
 * compute ceiling Pro raised (`WORKER_RESOURCE_LIMIT`) — the two are
 * independent, and Pro doesn't appear to change this one. Settled at
 * 65s/65s (130s nominal) — comfortably under 150s with real margin, while
 * still meaningfully higher than the Free-plan-safe 25s/25s. The
 * per-contact deadline check (added alongside the original 25s/25s
 * tightening) remains the real safety net regardless of this nominal
 * value. Overridable per-call for further tuning without a code change.
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
  /** Total AC-pull budget for this invocation, split evenly across every synced list — not a shared pool one list can exhaust for the others. */
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
    let anyListTimedOut = false;

    // Each list gets its own fair slice of the AC budget, measured from
    // when THAT list's turn starts — not one shared deadline a large list
    // could consume entirely, starving the others (see file header).
    const perListBudgetMs = acBudgetMs / SYNCED_LIST_IDS.length;
    // Sized to that same budget — see computePageSize's doc comment for
    // why a page that can never finish within budget is a real bug, not
    // just an inefficiency.
    const pageSize = computePageSize(perListBudgetMs);

    for (const listId of SYNCED_LIST_IDS) {
      let offset = (await db.getSyncProgress(listId)) ?? 0;
      const listDeadline = now() + perListBudgetMs;
      // See MAX_CONSECUTIVE_EMPTY_MATCH_PAGES's doc comment below.
      let consecutiveEmptyMatchPages = 0;

      for (;;) {
        if (now() >= listDeadline) {
          anyListTimedOut = true;
          break;
        }

        const knownSize = KNOWN_LIST_SIZES[listId];
        if (knownSize !== undefined && offset >= knownSize * MAX_OFFSET_MULTIPLIER) {
          await db.clearSyncProgress(listId);
          break;
        }

        const rawPage = await ac.getContactListPage({ listId, updatedSince: lastSync, limit: pageSize, offset });
        if (rawPage.length === 0) {
          await db.clearSyncProgress(listId);
          break;
        }

        // Defense-in-depth against a broken AC-side list filter — confirmed
        // via real data to have happened (acClient.ts's header comment has
        // the full story): AC returned List 3/5 memberships while we were
        // querying List 1/2. Never trust a returned row's own `.list`
        // blindly; discard anything that doesn't match what was actually
        // requested, exactly as plan Section 6.1 calls for. Pagination
        // still advances by the raw page length (AC's own result-set
        // position), not the filtered count.
        const page = rawPage.filter((membership) => membership.list === listId);

        // Second real incident involving this same broken filter: List 2's
        // pagination offset reached 12,852 while its true size is ~4,204
        // (confirmed via AC's own list-contact-count) — a genuinely empty
        // RAW page never occurred, because the filter keeps returning a
        // mix of every list regardless of what's requested, and the
        // per-row defense-in-depth above only discards the wrong ones
        // rather than making AC stop sending them. Distinct genuine List-2
        // contacts landed in staging: 4,221 — essentially the true total —
        // confirming the list's content was already fully discovered while
        // its pagination kept scanning uselessly, wasting AC-pull budget
        // that List 1 (which still had genuine content left to find) could
        // have used instead. Treat many consecutive pages with zero
        // genuine matches as exhaustion too, not just a literal empty
        // page — self-adapting, and correct regardless of whether AC's
        // filter parameter itself ever gets fixed.
        if (page.length === 0) {
          consecutiveEmptyMatchPages++;
          if (consecutiveEmptyMatchPages >= MAX_CONSECUTIVE_EMPTY_MATCH_PAGES) {
            await db.clearSyncProgress(listId);
            break;
          }
        } else {
          consecutiveEmptyMatchPages = 0;
        }

        // Checked per-contact, not just once per page: real invocation data
        // showed wall-clock time running far past the nominal budget (e.g.
        // ~150s against a 50s budget) — this loop used to have NO deadline
        // check at all once a page started, so a single slow page (up to
        // pageSize contacts, each its own network round-trip) could run
        // arbitrarily long before the next check. If it trips mid-page,
        // offset is left unadvanced, so the next invocation re-fetches
        // this same page and starts over — safe ONLY because pageSize is
        // now itself sized to reliably finish within budget (see
        // computePageSize's doc comment for the real incident where a page
        // that could never finish meant the offset could never advance at
        // all: not "some redundant re-processing," a permanent stall).
        let timedOutMidPage = false;
        for (const membership of page) {
          if (now() >= listDeadline) {
            timedOutMidPage = true;
            anyListTimedOut = true;
            break;
          }

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

        if (timedOutMidPage) break;

        offset += rawPage.length;
        await db.saveSyncProgress(listId, offset);
        await sleep(REQUEST_PACING_MS);
      }
      // Deliberately no early exit here — every list gets its turn every
      // invocation, regardless of whether an earlier one timed out.
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

    const partial = anyListTimedOut || transformPartial;

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
