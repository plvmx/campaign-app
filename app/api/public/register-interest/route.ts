/**
 * Public, unauthenticated data source + submission endpoint for the
 * Register Interest screen (app/public/register-interest, and the
 * admin-only next-fortnight preview at app/admin/register-interest).
 *
 * GET  — public-safe campaigns for a fortnight (all states; the client
 *        filters by state itself, same as the other /public/* GET routes —
 *        one cached response per window serves every caller). Defaults to
 *        the current fortnight; `?period=next` shifts the window to the
 *        fortnight starting right after the current one ends, for the
 *        admin preview screen. This data is already fully public regardless
 *        of who's asking (no PII, same shape as the other public campaign
 *        lists), so the extra window isn't gated — only the admin *button*
 *        that links to it is.
 * POST — records interest against one or more campaigns. This is the
 *        first *write* on a /public/* route: anonymous visitors have no
 *        RLS access to campaign_interest (its policy is admin/owning-leader
 *        only, see supabase/rls-policies.sql), so this uses the service
 *        role and does its own input validation in place of the RLS check.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { calculateCampaignDates, formatDateForDb, getFortnightDateRange } from '@/lib/campaignDates';
import { isCampaignPast } from '@/lib/campaignUtils';
import { isValidMobile, isValidEmail } from '@/lib/validation';
import type { AriseCampaign } from '@/lib/ariseLayout';

const getRateLimiter = createRateLimiter({ windowMs: 60 * 1000, maxAttempts: 30 });
// Writes get a tighter, longer-window limit than the read-only public GETs —
// matches /api/auth/validate-leader's 10-per-15-minutes for a similar
// legitimate-visitor-submits-a-form-a-few-times shape.
const postRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 10 });

const MAX_FIRST_NAME_LENGTH = 100;
const MAX_MOBILE_LENGTH = 20;
const MAX_EMAIL_LENGTH = 200;
const MAX_CAMPAIGN_IDS = 50;

export interface RegisterInterestGetResponse {
  campaigns: AriseCampaign[];
}

// Short-lived in-memory cache — the GET response is identical for every
// caller asking for the same window (all states), but there are now two
// possible windows (current / next), so this is keyed per-window rather
// than a single slot to avoid the two constantly evicting each other.
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, { expiresAt: number; response: RegisterInterestGetResponse }>();

export async function GET(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  const ip = getClientIp(request);
  if (getRateLimiter.isLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('SUPABASE_SERVICE_ROLE_KEY is not set');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const isNextPeriod = request.nextUrl.searchParams.get('period') === 'next';
    const { upcomingCampaignStart } = calculateCampaignDates();
    let periodStart = upcomingCampaignStart;
    if (isNextPeriod) {
      periodStart = new Date(upcomingCampaignStart);
      periodStart.setDate(periodStart.getDate() + 14);
    }
    const dates = getFortnightDateRange(periodStart);
    const dateStrings = dates.map(formatDateForDb);
    const cacheKey = `${isNextPeriod ? 'next' : 'current'}:${dateStrings[0]}`;

    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.response);
    }

    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .select('id, date, state, place, site, time, leader, category')
      .gte('date', dateStrings[0])
      .lte('date', dateStrings[dateStrings.length - 1])
      .order('date', { ascending: true })
      .order('state', { ascending: true })
      .order('place', { ascending: true })
      .order('time', { ascending: true });

    if (error) {
      console.error('public register-interest GET error:', error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    // Campaigns that have already started or finished are excluded — this
    // page is for finding upcoming campaigns to register interest in.
    const campaigns = ((data ?? []) as AriseCampaign[]).filter(c => !isCampaignPast(c.date, c.time));

    const response: RegisterInterestGetResponse = { campaigns };
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, response });

    return NextResponse.json(response);
  } catch (err) {
    console.error('public register-interest GET exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  const ip = getClientIp(request);
  if (postRateLimiter.isLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('SUPABASE_SERVICE_ROLE_KEY is not set');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const body: unknown = await request.json();
    const bodyObj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const firstName = typeof bodyObj.firstName === 'string' ? bodyObj.firstName.trim() : '';
    const mobile = typeof bodyObj.mobile === 'string' ? bodyObj.mobile.trim() : '';
    const email = typeof bodyObj.email === 'string' ? bodyObj.email.trim() : '';
    const interestType = bodyObj.interestType;
    const rawCampaignIds: unknown[] = Array.isArray(bodyObj.campaignIds) ? bodyObj.campaignIds : [];

    if (!firstName || firstName.length > MAX_FIRST_NAME_LENGTH) {
      return NextResponse.json({ error: 'Please enter your first name' }, { status: 400 });
    }
    if (mobile.length > MAX_MOBILE_LENGTH || email.length > MAX_EMAIL_LENGTH) {
      return NextResponse.json({ error: 'Please check your mobile number or email address' }, { status: 400 });
    }
    // A visitor is asked for a *valid* mobile or email (not merely a
    // non-empty one) — stricter than training_interest's presence-only check,
    // since this is the field the leader will actually follow up on.
    if (!isValidMobile(mobile) && !isValidEmail(email)) {
      return NextResponse.json({ error: 'Please enter a valid mobile number or email address' }, { status: 400 });
    }
    if (interestType !== 'in' && interestType !== 'more') {
      return NextResponse.json({ error: 'Invalid interest type' }, { status: 400 });
    }
    const isValidCampaignId = (id: unknown): id is string => typeof id === 'string' && id.length > 0;
    if (
      rawCampaignIds.length === 0 ||
      rawCampaignIds.length > MAX_CAMPAIGN_IDS ||
      !rawCampaignIds.every(isValidCampaignId)
    ) {
      return NextResponse.json({ error: 'Please tick at least one campaign' }, { status: 400 });
    }
    const campaignIds = rawCampaignIds as string[];

    const rows = campaignIds.map(campaignId => ({
      campaign_id: campaignId,
      first_name: firstName,
      mobile: mobile || null,
      email: email || null,
      interest_type: interestType,
    }));

    const { error } = await supabaseAdmin.from('campaign_interest').insert(rows);
    if (error) {
      console.error('public register-interest POST error:', error);
      return NextResponse.json({ error: 'Failed to register your interest' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('public register-interest POST exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
