import { supabase } from '@/lib/supabaseClient';
import type { ReportCountField } from '@/lib/campaignReportEntry';

/** Browser-side call to POST /api/admin/campaign-report-save. Throws with the
 * server's message on failure. (Separate file from the service so server code
 * doesn't import the browser Supabase client.) */
export async function requestCampaignReportSave(
  campaignId: string,
  counts: Record<ReportCountField, number>,
  names: Record<ReportCountField, string[]>,
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const res = await fetch('/api/admin/campaign-report-save', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ campaignId, ...counts, names }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || 'The report could not be saved.');
}
