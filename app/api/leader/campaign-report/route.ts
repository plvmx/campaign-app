/**
 * The TWOL Campaign Report for one campaign, for any signed-in leader who may
 * record results for it (lib/recordResultsAccess.ts: the campaign's own or
 * shared leader, a state reporter in that state, or a full admin).
 *
 *  GET  ?campaignId=…  → { campaign: { location, leader, date }, names, teamSize } — what the page
 *                         pre-fills, including names already saved for it.
 *  POST { campaignId, teamSize, partial, full, sinnersPrayers, followUp, names: {…} }
 *                      → { status: 'saved', names, email: 'sent' | 'disabled' | 'no_recipients' | 'failed' }
 *                         Saves the counts to campaign_reports and the names to results
 *                         (lib/services/campaignReportSaveService.ts), then emails the
 *                         counts to management (campaignReportEmailService.ts). A failed
 *                         email never undoes the save.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createRateLimiter } from '@/lib/rateLimit';
import { authorizeLeaderRequest } from '@/lib/leaderRouteGuard';
import { canRecordResultsFor } from '@/lib/recordResultsAccess';
import { formatReportDate, formatReportLocation } from '@/lib/campaignReportEntry';
import {
  getSavedReportNames,
  getSavedTeamSize,
  loadReportCampaign,
  parseReportSubmission,
  saveCampaignReport,
} from '@/lib/services/campaignReportSaveService';
import { sendCampaignReportEmail } from '@/lib/services/campaignReportEmailService';

// Per signed-in leader, so a stuck button or script can't flood the database or management's inbox.
const saveLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxAttempts: 20 });
const readLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxAttempts: 120 });

const FORBIDDEN = { error: "You can't record results for this campaign." };

export async function GET(request: NextRequest) {
  const auth = await authorizeLeaderRequest(request, 'leader/campaign-report');
  if (!auth.ok) return auth.response;
  if (readLimiter.isLimited(auth.userId)) {
    return NextResponse.json({ error: 'Too many requests. Please wait a few minutes.' }, { status: 429 });
  }

  const campaignId = request.nextUrl.searchParams.get('campaignId') ?? '';
  if (!campaignId || campaignId.length > 100) return NextResponse.json({ error: 'A campaign is required.' }, { status: 400 });

  try {
    const campaign = await loadReportCampaign(supabaseAdmin, campaignId);
    if (!campaign) return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
    if (!canRecordResultsFor(campaign, auth.caller, auth.sharedWithMeOwners)) {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    return NextResponse.json({
      campaign: { location: formatReportLocation(campaign), leader: campaign.leader, date: formatReportDate(campaign.date) },
      names: await getSavedReportNames(supabaseAdmin, campaignId),
      teamSize: await getSavedTeamSize(supabaseAdmin, campaignId),
    });
  } catch (err) {
    console.error('[leader/campaign-report] load failed:', err);
    return NextResponse.json({ error: 'The report could not be loaded.' }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorizeLeaderRequest(request, 'leader/campaign-report');
  if (!auth.ok) return auth.response;
  if (saveLimiter.isLimited(auth.userId)) {
    return NextResponse.json({ error: 'Too many requests. Please wait a few minutes.' }, { status: 429 });
  }

  const submission = parseReportSubmission(await request.json().catch(() => null));
  if (!submission) {
    return NextResponse.json(
      { error: 'A campaign, a team size from 1 to 99, a number from 0 to 99 for each count, and one valid name for every counted person are required.' },
      { status: 400 },
    );
  }

  let campaign;
  try {
    campaign = await loadReportCampaign(supabaseAdmin, submission.campaignId);
  } catch (err) {
    console.error('[leader/campaign-report] campaign lookup failed:', err);
    return NextResponse.json({ error: 'The report could not be saved.' }, { status: 502 });
  }
  if (!campaign) return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
  if (!canRecordResultsFor(campaign, auth.caller, auth.sharedWithMeOwners)) {
    return NextResponse.json(FORBIDDEN, { status: 403 });
  }

  let saved;
  try {
    saved = await saveCampaignReport(supabaseAdmin, { ...submission, campaign, actorUserId: auth.userId });
  } catch (err) {
    console.error('[leader/campaign-report] save failed:', err);
    return NextResponse.json({ error: 'The report could not be saved.' }, { status: 502 });
  }

  let email: 'sent' | 'disabled' | 'no_recipients' | 'failed';
  try {
    const result = await sendCampaignReportEmail(supabaseAdmin, { campaignId: submission.campaignId, counts: submission.counts, teamSize: submission.teamSize });
    email = result.status === 'sent' || result.status === 'disabled' || result.status === 'no_recipients' ? result.status : 'failed';
  } catch (err) {
    console.error('[leader/campaign-report] email failed:', err);
    email = 'failed';
  }
  return NextResponse.json({ status: saved.status, names: saved.names, email });
}
