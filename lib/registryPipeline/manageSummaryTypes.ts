// Shared shapes between the /registry/manage API routes
// (app/api/registry/manage-summary/route.ts, manage-record/route.ts,
// manage-edit-log/route.ts) and their pages (app/registry/manage/page.tsx,
// app/registry/manage/edit-log/page.tsx) — kept out of route.ts itself,
// same reason as recentRegistrationTypes.ts: Next.js's App Router
// restricts a route.ts's exports to recognized HTTP methods and route
// config.
import type { EditableRegistrantField } from './registrantValidation';

/** One row of registry.sync_log, whichever ran most recently regardless of outcome — see supabase/functions/ac-sync/db.ts and scripts/add_status_to_sync_log.sql for what writes these. */
export interface SyncLogSummary {
  startedAt: string;
  completedAt: string | null;
  status: 'success' | 'failed' | 'partial' | 'crashed' | null;
  recordsIn: number | null;
  recordsUpserted: number | null;
  errors: number | null;
  notes: string | null;
}

/**
 * One registry.registrants row, as shown on the Manage console: enough to
 * both tally the grid (state/registeredAt — see
 * lib/registryPipeline/registrantCounts.ts) and, when a national admin
 * clicks a non-zero cell, list the actual matching records underneath it.
 * Same fields (and same audience — national_admin/whatsapp_admin, MFA
 * satisfied) as RecentRegistration (recentRegistrationTypes.ts), plus the
 * row id for a stable React key.
 */
export interface ManageRegistrant {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  state: string | null;
  postcode: string | null;
  registeredAt: string | null;
}

export interface ManageSummaryResponse {
  /** null only if registry.sync_log has no rows at all yet. */
  lastSync: SyncLogSummary | null;
  registrants: ManageRegistrant[];
}

/** PATCH /api/registry/manage-record body — one hand-edit to one field of one registrant. `value: null` clears the field. */
export interface ManageRecordEditRequest {
  id: string;
  field: EditableRegistrantField;
  value: string | null;
}

/** Echoes back the field/value as actually stored (post-normalization — e.g. a blank string comes back as null) so the page can update its in-memory copy without re-fetching. */
export interface ManageRecordEditResponse {
  id: string;
  field: EditableRegistrantField;
  value: string | null;
}

/**
 * One row of registry.registrant_edits, joined with the registrant it was
 * about — for /registry/manage/edit-log. `registrant` is null only if that
 * registrant row was itself later deleted (the FK is ON DELETE CASCADE, so
 * in practice its edit rows would be gone too — this is defensive typing,
 * not an expected case).
 */
export interface RegistrantEditLogEntry {
  id: number;
  /** The actual registry.registrants column that was changed (e.g. 'first_name') — look up EDITABLE_FIELD_LABELS for a display label. */
  field: string;
  oldValue: string | null;
  newValue: string | null;
  editedByEmail: string | null;
  editedAt: string;
  registrant: { firstName: string | null; lastName: string | null; email: string | null; state: string | null } | null;
}

export interface RegistrantEditLogResponse {
  entries: RegistrantEditLogEntry[];
  totalCount: number;
}
