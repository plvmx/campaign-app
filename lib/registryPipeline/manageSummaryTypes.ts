// Shared shape between app/api/registry/manage-summary/route.ts and its
// page (app/registry/manage/page.tsx) — kept out of route.ts itself, same
// reason as recentRegistrationTypes.ts: Next.js's App Router restricts a
// route.ts's exports to recognized HTTP methods and route config.

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
