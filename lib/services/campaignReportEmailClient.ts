import { supabase } from '@/lib/supabaseClient';
import type { ReportCountField } from '@/lib/campaignReportEntry';

export type ReportEmailOutcome = 'sent' | 'disabled' | 'no_recipients';

/** Browser-side call to POST /api/admin/campaign-report-email. Throws with the
 * server's message on failure. (Separate file from the service so server code
 * doesn't import the browser Supabase client.) */
export async function requestCampaignReportEmail(
  campaignId: string,
  counts: Record<ReportCountField, number>,
): Promise<ReportEmailOutcome> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const res = await fetch('/api/admin/campaign-report-email', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ campaignId, ...counts }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || 'The report could not be emailed.');
  return (json as { status: ReportEmailOutcome }).status;
}
