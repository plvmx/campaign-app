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

/** Read-only access to ActiveCampaign — implemented by ac-sync/acClient.ts. */
export interface AcPort {
  /**
   * One page of contact-list membership rows for a single AC list, filtered
   * to those updated since `updatedSince` (null on the very first/backfill
   * run — AC then returns everything). Paginated by `limit`/`offset`;
   * an empty array means the caller has reached the end.
   */
  getContactListPage(params: {
    listId: string;
    updatedSince: string | null;
    limit: number;
    offset: number;
  }): Promise<AcContactListMembership[]>;

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
   * Records progress made against one list's pagination *within a single
   * logical sync pass* (which may now span multiple invocations — see
   * sync.ts's time-budget note). `null` means "fully drained": either
   * nothing has been pulled yet this pass, or the previous invocation
   * reached an empty page for this list. A non-null offset means "resume
   * here" — a prior invocation ran out of time partway through this list.
   */
  getSyncProgress(listId: string): Promise<number | null>;
  saveSyncProgress(listId: string, nextOffset: number): Promise<void>;
  /** Called once a list's pagination hits an empty page — resets it to start-from-0 for the next logical pass. */
  clearSyncProgress(listId: string): Promise<void>;
  /**
   * Updates records_in/records_upserted/errors on an in-progress sync_log
   * row WITHOUT setting completed_at — used when a run is cut short by its
   * time budget, so getLastCompletedSyncTimestamp() correctly keeps
   * ignoring it (a partial pass must never advance the incremental cursor).
   */
  recordPartialSync(id: number, counts: { recordsIn: number; recordsUpserted: number; errors: number }): Promise<void>;
}
