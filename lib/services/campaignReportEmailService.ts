/**
 * Emails a submitted TWOL Campaign Report to management — backs
 * POST /api/admin/campaign-report-email. Injected client (always
 * supabaseAdmin). Location, leader and date come from the campaign row, never
 * from the request, so the email can't say something the campaign doesn't.
 * Reads the on/off flag and recipients fresh on every call so an admin's
 * change takes effect immediately. Throws if sending fails.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CAMPAIGN_REPORT_EMAIL_ENABLED_KEY,
  CAMPAIGN_REPORT_EMAIL_RECIPIENTS_KEY,
  parseRecipientList,
  validateRecipientList,
} from '@/lib/campaignReportEmailSettings';
import { buildCampaignReportEmail } from '@/lib/campaignReportEmail';
import { formatReportDate, formatReportLocation, isValidCount, type ReportCountField } from '@/lib/campaignReportEntry';
import { sendEmail } from '@/lib/resendClient';

export type SendReportEmailResult =
  | { status: 'sent'; recipients: number }
  | { status: 'disabled' }
  | { status: 'no_recipients' }
  | { status: 'campaign_not_found' };

/** Pulls the three counts out of an untrusted request body; null if any is not a whole number 0-99. */
export function parseReportCounts(body: unknown): Record<ReportCountField, number> | null {
  if (!body || typeof body !== 'object') return null;
  const { partial, full, sinnersPrayers } = body as Record<string, unknown>;
  if (!isValidCount(partial) || !isValidCount(full) || !isValidCount(sinnersPrayers)) return null;
  return { partial, full, sinnersPrayers };
}

export async function sendCampaignReportEmail(
  client: SupabaseClient,
  input: { campaignId: string; counts: Record<ReportCountField, number> },
  sender: typeof sendEmail = sendEmail,
): Promise<SendReportEmailResult> {
  const { data: settings, error: settingsError } = await client
    .from('app_settings')
    .select('setting_key, setting_value')
    .in('setting_key', [CAMPAIGN_REPORT_EMAIL_ENABLED_KEY, CAMPAIGN_REPORT_EMAIL_RECIPIENTS_KEY]);
  if (settingsError) throw new Error(`Could not read email settings: ${settingsError.message}`);

  const byKey = new Map((settings ?? []).map((r: { setting_key: string; setting_value: string | null }) => [r.setting_key, r.setting_value]));
  if ((byKey.get(CAMPAIGN_REPORT_EMAIL_ENABLED_KEY) ?? '').toLowerCase() !== 'true') return { status: 'disabled' };

  const recipients = parseRecipientList(byKey.get(CAMPAIGN_REPORT_EMAIL_RECIPIENTS_KEY));
  // Settings are validated on write, but never mail an address that fails the rules now.
  if (recipients.length === 0 || validateRecipientList(recipients)) return { status: 'no_recipients' };

  const { data: campaign, error: campaignError } = await client
    .from('campaigns')
    .select('date, state, place, site, leader')
    .eq('id', input.campaignId)
    .maybeSingle();
  if (campaignError) throw new Error(`Could not load the campaign: ${campaignError.message}`);
  if (!campaign) return { status: 'campaign_not_found' };

  const email = buildCampaignReportEmail({
    location: formatReportLocation(campaign),
    leader: campaign.leader,
    date: formatReportDate(campaign.date),
    counts: input.counts,
  });
  await sender({ to: recipients, ...email });
  return { status: 'sent', recipients: recipients.length };
}
