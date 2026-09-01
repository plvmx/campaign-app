// Dependency-injection ports for the registry pipeline's orchestration
// logic (sync.ts / transform.ts). Defining these as plain interfaces (no
// supabase-js, no Deno, no fetch) is what lets runSync/transformPendingStagingEvents
// be unit tested with simple fakes, and lets the concrete implementations
// (supabase/functions/ac-sync/acClient.ts, db.ts) live entirely in the Deno
// Edge Function without this module needing to know or care.

import type {
  AcContactCore,
  AcContactListMembership,
  AcContactTag,
  AcFieldValue,
  KnownSourceTag,
  RawAcContactPayload,
} from './types.ts';

/**
 * Read-only access to ActiveCampaign — implemented by ac-sync/acClient.ts.
 *
 * Discovery is a single account-wide `/contacts` sweep, ordered by the
 * contact's own immutable id — not a per-list `/contactLists` pagination
 * loop. See docs/registry-pipeline/FORWARD_SYNC_REDESIGN.md and
 * OPERATIONS.md's 2026-09-01 probe results for why: every `filters[...]`
 * param tried on `/contactLists` (`list`, `listid`, `updated_since`) was
 * confirmed broken, and its pagination re-fetched some contacts 300+
 * times while registrant discovery stalled for four days. `/contacts`
 * ordered by id was confirmed genuinely stable (identical page fetched
 * twice, 8s apart, identical order) and its own `filters[created_after]`/
 * `filters[updated_after]` were confirmed to actually filter — the first
 * AC filters of any kind in this project to pass a live future-dated
 * test.
 */
export interface AcPort {
  /**
   * One page of AC contacts, ordered ascending by contact id (confirmed
   * stable — see above). When `updatedSince` is set, scoped server-side
   * to contacts created OR updated on or after that timestamp
   * (`filters[updated_after]`, confirmed working) — every incremental run
   * after the first. `null` (the first-ever backfill run) returns the
   * whole account, unfiltered — same `backfill` vs `sync` distinction as
   * before. Paginated by `limit`/`offset` — safe to resume from a saved
   * offset now that ordering is confirmed stable, unlike `/contactLists`.
   * An empty array means the caller has reached the end.
   */
  getContactsPage(params: {
    updatedSince: string | null;
    limit: number;
    offset: number;
  }): Promise<{ id: string }[]>;

  /**
   * Every list-membership row for ONE contact — not scoped to a specific
   * list server-side. `filters[listid]` on this endpoint is confirmed
   * broken (see sync.ts's file header); a per-contact filter param is
   * unverified either way, so the caller must still check each returned
   * row's own `.contact` against `contactId` before trusting it (same
   * defense-in-depth this pipeline already applies everywhere else on
   * this endpoint).
   */
  getContactListMemberships(contactId: string): Promise<AcContactListMembership[]>;

  /** Core fields + custom fieldValues + tags for one contact, by AC contact ID. */
  getContactDetail(contactId: string): Promise<{
    core: AcContactCore;
    fieldValues: AcFieldValue[];
    tags: AcContactTag[];
  }>;
}

export interface StagingEventRow {
  id: number;
  raw_payload: RawAcContactPayload;
}

/** Read/write access to staging.* / registry.* — implemented by ac-sync/db.ts. */
export interface DbPort {
  /** Inserts a registry.sync_log row with run_type='sync', returns its id. */
  startSyncLog(): Promise<number>;
  /**
   * max(completed_at) from registry.sync_log where run_type='sync' AND
   * status='success' — null on the first-ever run. Must filter on
   * status='success', not merely `completed_at IS NOT NULL`: failSyncLog
   * also sets completed_at (on any thrown error), so that alone let a
   * failed run's timestamp masquerade as a trustworthy incremental cursor.
   * Confirmed via live data 2026-09-01 — see
   * scripts/add_status_to_sync_log.sql and docs/registry-pipeline/OPERATIONS.md.
   */
  getLastCompletedSyncTimestamp(): Promise<string | null>;
  insertStagingEvent(input: {
    sourceListId: string;
    acContactId: string;
    eventType: 'backfill' | 'sync';
    rawPayload: RawAcContactPayload;
  }): Promise<void>;
  completeSyncLog(id: number, result: { recordsIn: number; recordsUpserted: number; errors: number }): Promise<void>;
  failSyncLog(id: number, error: string): Promise<void>;

  /** At most `limit` rows with processed_at IS NULL — caps how much a single transform call ever loads into memory. */
  getPendingStagingEvents(limit: number): Promise<StagingEventRow[]>;
  /** registry.known_source_tags, fetched fresh once per transform run (plan 6.2: "cached, refreshed periodically"). */
  getKnownSourceTags(): Promise<KnownSourceTag[]>;
  upsertRegistrant(input: {
    acContactId: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    phoneRaw: string | null;
    state: string | null;
    postcode: string | null;
    registeredAt: string | null;
    interestedInTraining: string | null;
    churchLeader: string | null;
    churchName: string | null;
  }): Promise<{ id: string }>;
  insertRegistrationEvent(input: {
    registrantId: string;
    sourceListId: string;
    sourceTag: string | null;
    eventType: 'new_registration';
    rawStagingId: number;
  }): Promise<void>;
  /** Marks a staging row done. Pass a reason (e.g. 'skipped: list status not active') to record a non-error skip, or null for a clean success. */
  markStagingProcessed(id: number, skipReason: string | null): Promise<void>;
  markStagingError(id: number, error: string): Promise<void>;

  /**
   * Records progress made against the `/contacts` sweep's pagination
   * *within a single logical sync pass* (which may now span multiple
   * invocations — see sync.ts's time-budget note). Keyed by a fixed
   * sentinel (`'contacts'` — see sync.ts), not a per-list key, since
   * discovery is now one account-wide sweep, not one pass per list (see
   * ports.ts's `AcPort` doc comment for why). `null` means "fully
   * drained": either nothing has been pulled yet this pass, or the
   * previous invocation reached an empty page. A non-null offset means
   * "resume here" — a prior invocation ran out of time partway through.
   */
  getSyncProgress(key: string): Promise<number | null>;
  saveSyncProgress(key: string, nextOffset: number): Promise<void>;
  /** Called once the sweep's pagination hits an empty page — resets it to start-from-0 for the next logical pass. */
  clearSyncProgress(key: string): Promise<void>;
  /**
   * Updates records_in/records_upserted/errors on an in-progress sync_log
   * row WITHOUT setting completed_at — used when a run is cut short by its
   * time budget, so getLastCompletedSyncTimestamp() correctly keeps
   * ignoring it (a partial pass must never advance the incremental cursor).
   */
  recordPartialSync(id: number, counts: { recordsIn: number; recordsUpserted: number; errors: number }): Promise<void>;
}
