import { supabase } from '@/lib/supabaseClient';
import type { ReportCountField } from '@/lib/campaignReportEntry';

/** What the report page pre-fills for a campaign. */
export interface CampaignReportView {
  campaign: { location: string; leader: string; date: string };
  /** Names already saved for the campaign, per count field. */
  names: Record<ReportCountField, string[]>;
  /** Team size on the earlier saved report, if any. */
  teamSize: number | null;
}

export type ReportEmailOutcome = 'sent' | 'disabled' | 'no_recipients' | 'failed';

/** Browser-side calls to /api/leader/campaign-report. Both throw with the
 * server's message on failure. (Separate file from the service so server code
 * doesn't import the browser Supabase client.) */
async function authHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');
  return `Bearer ${session.access_token}`;
}

export async function fetchCampaignReport(campaignId: string): Promise<CampaignReportView> {
  const res = await fetch(`/api/leader/campaign-report?campaignId=${encodeURIComponent(campaignId)}`, {
    headers: { Authorization: await authHeader() },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || 'The report could not be loaded.');
  return json as CampaignReportView;
}

/** Saves the report, then (server-side) emails the counts. A failed email is reported, never thrown. */
export async function submitCampaignReport(
  campaignId: string,
  teamSize: number,
  counts: Record<ReportCountField, number>,
  names: Record<ReportCountField, string[]>,
): Promise<ReportEmailOutcome> {
  const res = await fetch('/api/leader/campaign-report', {
    method: 'POST',
    headers: { Authorization: await authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ campaignId, teamSize, ...counts, names }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || 'The report could not be saved.');
  return (json as { email: ReportEmailOutcome }).email;
}
