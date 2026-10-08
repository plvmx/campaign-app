import { supabase } from './supabaseClient';
import { getCurrentUser } from './auth';
import { getUserProfile } from './userProfile';

export interface ResultsLogRow {
  first_name: string;
  category_code: string;
}

/** Strips everything but the category from a row before it's logged — see logResultsSave. */
function withoutNames(rows: ResultsLogRow[]): { category_code: string }[] {
  return rows.map((row) => ({ category_code: row.category_code }));
}

/**
 * Fire-and-forget audit logger for the Record Results save flow.
 *
 * Writes one row per save *batch* to `results_changes_log`. The point of this
 * log is diagnostic: when a leader reports "I entered names and they
 * disappeared", we can look up their campaign and see exactly what the client
 * attempted to send and whether the save succeeded.
 *
 * Names are deliberately NOT written to the log — only each attempted row's
 * `category_code`. Recorded first names are shown publicly strictly for prayer
 * with a promise that AFJ doesn't keep them beyond the week (see the notice on
 * /public/campaign-results), and this table is never pruned, so a name logged
 * here would outlive that promise indefinitely. The per-category counts are
 * still enough to tell "the client never sent it" from "the save failed".
 *
 * The function never throws — logging failures must not break the save flow
 * the user just triggered.
 */
export function logResultsSave(params: {
  campaignId: string;
  status: 'SUCCESS' | 'ERROR';
  attemptedUpserts: ResultsLogRow[];
  attemptedDeletes: ResultsLogRow[];
  errorMessage?: string;
}): void {
  // No-op if there's nothing to record (avoids polluting the log with empty
  // ticks from the auto-save interval).
  if (params.attemptedUpserts.length === 0 && params.attemptedDeletes.length === 0) {
    return;
  }

  void (async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return;

      let userName: string | null = null;
      try {
        const profile = await getUserProfile();
        userName = profile?.name ?? null;
      } catch {
        // Non-fatal.
      }

      await supabase.from('results_changes_log').insert({
        campaign_id:       params.campaignId,
        user_id:           user.id,
        status:            params.status,
        attempted_upserts: withoutNames(params.attemptedUpserts),
        attempted_deletes: withoutNames(params.attemptedDeletes),
        error_message:     params.errorMessage ?? null,
        user_email:        user.email ?? null,
        user_name:         userName,
      });
    } catch (err) {
      console.error('logResultsSave failed:', err);
    }
  })();
}
