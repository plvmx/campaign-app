/**
 * Texts a campaign's owning leader (state_leaders.mobile, via ClickSend)
 * whenever someone registers interest via the public Register Interest
 * screen or the personalized Campaigns Near Me map — both write into
 * campaign_interest and call notifyLeadersOfCampaignInterest() right after
 * their insert succeeds. Only the owning leader (campaign.leader) is
 * texted, never a campaign's shared leaders.
 *
 * A single submission can tick several campaigns; if more than one
 * resolves to the same (state, leader), they're combined into one text
 * rather than sending one per campaign.
 *
 * Split into pure logic (fully unit tested, no mocks) and one orchestration
 * function taking an injected SupabaseClient — same shape as
 * backupService.ts's exportBackup(client, ...), so it can be exercised with
 * lib/services/__tests__/supabaseMock.ts and never accidentally imports the
 * browser client (this only ever runs from a public API route under the
 * service role — a leader's mobile isn't readable by an anonymous visitor
 * through RLS).
 *
 * Best-effort by design: notifyLeadersOfCampaignInterest() never throws.
 * Every attempt — sent, failed, or skipped for no mobile on file — is
 * logged to campaign_interest_sms_log so a misconfiguration doesn't go
 * unnoticed the way registry.whatsapp_invite_log's own gap did before it
 * had a dedicated log table.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isValidMobile } from '@/lib/validation';
import { normalizeMobile } from '@/lib/auth';
import { combinePlaceAndSite } from '@/lib/placeSite';
import { getSiteUrl } from '@/lib/siteUrl';
import { sendSms } from '@/lib/clickSendClient';
import { getErrorMessage } from '@/lib/errorUtils';

export type CampaignInterestType = 'in' | 'more';

export interface CampaignLeaderInfo {
  id: string;
  state: string;
  leader: string;
  date: string; // 'YYYY-MM-DD'
  place: string;
  site: string;
  time: string;
}

export interface LeaderCampaignGroup {
  state: string;
  leader: string;
  campaigns: CampaignLeaderInfo[];
}

/** '04XXXXXXXX' -> '+614XXXXXXXX'; null if not a plausible AU mobile. */
export function toE164AuMobile(localMobile: string): string | null {
  if (!isValidMobile(localMobile)) return null;
  const normalized = normalizeMobile(localMobile);
  return `+61${normalized.slice(1)}`;
}

/** Groups campaigns by their owning (state, leader) pair, keyed as 'STATE::leader'. */
export function groupCampaignsByLeader(campaigns: CampaignLeaderInfo[]): Map<string, LeaderCampaignGroup> {
  const groups = new Map<string, LeaderCampaignGroup>();
  for (const campaign of campaigns) {
    const key = `${campaign.state}::${campaign.leader}`;
    const existing = groups.get(key);
    if (existing) {
      existing.campaigns.push(campaign);
    } else {
      groups.set(key, { state: campaign.state, leader: campaign.leader, campaigns: [campaign] });
    }
  }
  return groups;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Compact date for SMS, parsed directly from 'YYYY-MM-DD' (no Date object, no timezone risk). */
function formatShortDate(dateStr: string): string {
  const [, month, day] = dateStr.split('-').map(Number);
  return `${day} ${MONTH_ABBR[(month ?? 1) - 1] ?? ''}`.trim();
}

const INTEREST_TYPE_LABEL: Record<CampaignInterestType, string> = {
  in: "Yes I'm In",
  more: 'Tell Me More',
};

/** Builds the SMS body for one leader's group of ticked campaigns. */
export function buildLeaderSmsMessage(
  registrantFirstName: string,
  interestType: CampaignInterestType,
  campaigns: CampaignLeaderInfo[]
): string {
  const typeLabel = INTEREST_TYPE_LABEL[interestType];
  const link = `${getSiteUrl()}/campaign-interest`;

  if (campaigns.length === 1) {
    const c = campaigns[0];
    const placeLabel = combinePlaceAndSite(c.place, c.site);
    return `<Important AFJ Notification> ${registrantFirstName} has registered interest ("${typeLabel}") in your campaign at ${placeLabel}, ${formatShortDate(c.date)} ${c.time}. View details here: ${link}`;
  }

  const list = campaigns
    .map((c) => `${combinePlaceAndSite(c.place, c.site)} (${formatShortDate(c.date)})`)
    .join(', ');
  return `<Important AFJ Notification> ${registrantFirstName} has registered interest ("${typeLabel}") in ${campaigns.length} of your campaigns: ${list}. View details here: ${link}`;
}

interface NotifyLeadersParams {
  campaignIds: string[];
  registrantFirstName: string;
  interestType: CampaignInterestType;
}

/**
 * Fetches the given campaigns, groups them by owning leader, and best-effort
 * texts each leader with a mobile on file — logging every outcome. Never
 * throws; a lookup/send/logging failure for one leader never affects
 * another, and never propagates to the caller.
 */
export async function notifyLeadersOfCampaignInterest(client: SupabaseClient, params: NotifyLeadersParams): Promise<void> {
  const { campaignIds, registrantFirstName, interestType } = params;
  if (campaignIds.length === 0) return;

  try {
    const { data, error } = await client
      .from('campaigns')
      .select('id, state, leader, date, place, site, time')
      .in('id', campaignIds);
    if (error) throw error;

    const campaigns = ((data ?? []) as CampaignLeaderInfo[]).filter((c) => c.state && c.leader);
    if (campaigns.length === 0) return;

    const groups = groupCampaignsByLeader(campaigns);

    await Promise.all(
      Array.from(groups.values()).map((group) =>
        notifyOneLeader(client, group, registrantFirstName, interestType)
      )
    );
  } catch (err) {
    console.error('[campaignInterestSmsService] notifyLeadersOfCampaignInterest error:', getErrorMessage(err));
  }
}

async function notifyOneLeader(
  client: SupabaseClient,
  group: LeaderCampaignGroup,
  registrantFirstName: string,
  interestType: CampaignInterestType
): Promise<void> {
  const campaignIds = group.campaigns.map((c) => c.id);
  let status: 'sent' | 'failed' | 'skipped_no_mobile';
  let mobile: string | null = null;
  let messageBody: string | null = null;
  let error: string | null = null;
  let clicksendMessageId: string | null = null;

  try {
    const { data: leaderRow, error: leaderError } = await client
      .from('state_leaders')
      .select('mobile')
      .eq('state', group.state)
      .eq('leader', group.leader)
      .maybeSingle();
    if (leaderError) throw leaderError;

    mobile = (leaderRow as { mobile: string | null } | null)?.mobile ?? null;
    const e164 = mobile ? toE164AuMobile(mobile) : null;

    if (!e164) {
      status = 'skipped_no_mobile';
    } else {
      messageBody = buildLeaderSmsMessage(registrantFirstName, interestType, group.campaigns);
      const result = await sendSms(e164, messageBody);
      clicksendMessageId = result.messageId;
      status = 'sent';
    }
  } catch (err) {
    status = 'failed';
    error = getErrorMessage(err);
  }

  try {
    await client.from('campaign_interest_sms_log').insert({
      state: group.state,
      leader: group.leader,
      mobile,
      campaign_ids: campaignIds,
      interest_type: interestType,
      message_body: messageBody,
      status,
      error,
      clicksend_message_id: clicksendMessageId,
    });
  } catch (logErr) {
    console.error('[campaignInterestSmsService] failed to write campaign_interest_sms_log:', getErrorMessage(logErr));
  }
}
