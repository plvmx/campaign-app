import { supabase } from '@/lib/supabaseClient';
import type { LegacyReportVisitSummary } from '@/lib/legacyReportVisits';

/** Browser-side call to GET /api/admin/legacy-report-visits. Throws with the server's message on failure. */
export async function fetchLegacyReportVisitSummary(): Promise<LegacyReportVisitSummary> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');
  const res = await fetch('/api/admin/legacy-report-visits', { headers: { Authorization: `Bearer ${session.access_token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || 'Failed to load the visit count');
  return json as LegacyReportVisitSummary;
}
