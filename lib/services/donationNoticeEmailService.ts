/**
 * Emails management when a bank-transfer donor uses the optional notice on
 * /public/donate — backs POST /api/public/donate. Injected client (always
 * supabaseAdmin). Reads the on/off flag and recipients fresh on every call
 * so an admin's change takes effect immediately. No row is stored anywhere
 * — this is email-only for now (see CLAUDE.md's Phase 0 donations note);
 * storing submissions in a table is a possible later follow-up, not built
 * here. Throws if sending fails.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DONATION_NOTICE_EMAIL_ENABLED_KEY,
  DONATION_NOTICE_EMAIL_RECIPIENTS_KEY,
  parseRecipientList,
  validateRecipientList,
} from '@/lib/donationNoticeEmailSettings';
import { buildDonationNoticeEmail, type DonationNoticeEmailInput } from '@/lib/donationNoticeEmail';
import { sendEmail } from '@/lib/resendClient';

export type SendDonationNoticeResult =
  | { status: 'sent'; recipients: number }
  | { status: 'disabled' }
  | { status: 'no_recipients' };

export async function sendDonationNoticeEmail(
  client: SupabaseClient,
  input: DonationNoticeEmailInput,
  sender: typeof sendEmail = sendEmail,
): Promise<SendDonationNoticeResult> {
  const { data: settings, error: settingsError } = await client
    .from('app_settings')
    .select('setting_key, setting_value')
    .in('setting_key', [DONATION_NOTICE_EMAIL_ENABLED_KEY, DONATION_NOTICE_EMAIL_RECIPIENTS_KEY]);
  if (settingsError) throw new Error(`Could not read email settings: ${settingsError.message}`);

  const byKey = new Map((settings ?? []).map((r: { setting_key: string; setting_value: string | null }) => [r.setting_key, r.setting_value]));
  if ((byKey.get(DONATION_NOTICE_EMAIL_ENABLED_KEY) ?? '').toLowerCase() !== 'true') return { status: 'disabled' };

  const recipients = parseRecipientList(byKey.get(DONATION_NOTICE_EMAIL_RECIPIENTS_KEY));
  // Settings are validated on write, but never mail an address that fails the rules now.
  if (recipients.length === 0 || validateRecipientList(recipients)) return { status: 'no_recipients' };

  const email = buildDonationNoticeEmail(input);
  await sender({ to: recipients, ...email });
  return { status: 'sent', recipients: recipients.length };
}
