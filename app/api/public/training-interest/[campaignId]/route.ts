/**
 * Public, unauthenticated data source + submission endpoint for one training
 * session's interest page (/public/training/[campaignId]). Unlike the other
 * /public/* GETs, this is scoped to a single campaign id rather than a
 * shared list — no in-memory cache, since each lookup is a single indexed
 * row rather than a table scan.
 *
 * GET  — the training campaign's public-safe details (only ever returns a
 *        campaign whose category is BOTJ or TLT — anything else 404s, same
 *        as a non-existent id, so this can't be used to peek at arbitrary
 *        non-training campaigns).
 * POST — records interest against this campaign. Anonymous visitors have no
 *        RLS access to training_interest (its policy is admin/owning-leader
 *        only, see supabase/rls-policies.sql), so this uses the service role
 *        and does its own input validation in place of the RLS check.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { isTrainingCategory } from '@/lib/services/trainingInterestService';

const getRateLimiter = createRateLimiter({ windowMs: 60 * 1000, maxAttempts: 30 });
// Writes get a tighter, longer-window limit than the read-only public GET —
// matches /api/public/register-interest's POST limit.
const postRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 10 });

const MAX_NAME_LENGTH = 100;
const MAX_MOBILE_LENGTH = 20;
const MAX_EMAIL_LENGTH = 200;
// Deliberately loose — just enough to catch obviously-wrong input, not a
// strict RFC 5322 validator (real deliverability is confirmed by the leader
// following up, not by this check).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TrainingInterestCampaignInfo {
  id: string;
  date: string;
  state: string;
  place: string;
  site: string;
  time: string;
  leader: string;
  category: string;
}

export interface TrainingInterestGetResponse {
  campaign: TrainingInterestCampaignInfo;
  categoryName: string;
}

/**
 * Loads one training campaign's public-safe details, or null if it doesn't
 * exist, its id isn't well-formed, or its category isn't BOTJ/TLT — all
 * treated identically (404) so this can't be used to distinguish "no such
 * campaign" from "not a training campaign". Exported so
 * app/public/training/[campaignId]/page.tsx's generateMetadata can reuse it
 * directly (server-to-server, no HTTP round trip) instead of duplicating
 * this query.
 */
export async function loadTrainingCampaign(campaignId: string): Promise<TrainingInterestCampaignInfo | null> {
  // A malformed id would otherwise reach Postgres as "invalid input syntax
  // for type uuid" and bubble up as a 500 — checked here so a garbled link
  // 404s cleanly instead.
  if (!UUID_PATTERN.test(campaignId)) return null;

  const { data, error } = await supabaseAdmin
    .from('campaigns')
    .select('id, date, state, place, site, time, leader, category')
    .eq('id', campaignId)
    .maybeSingle();

  if (error) throw error;
  if (!data || !isTrainingCategory(data.category)) return null;
  return data as TrainingInterestCampaignInfo;
}

// campaign_categories rarely changes — a short-lived cache avoids a second
// live query on every public page view just to resolve a display name.
const CATEGORY_NAME_CACHE_TTL_MS = 5 * 60 * 1000;
let categoryNameCache: { expiresAt: number; names: Map<string, string> } | null = null;

async function getCategoryName(code: string): Promise<string> {
  if (!categoryNameCache || categoryNameCache.expiresAt <= Date.now()) {
    const { data, error } = await supabaseAdmin.from('campaign_categories').select('code, name');
    if (error) {
      console.error('public training-interest: failed to load campaign_categories:', error);
      // Fall through to the code itself below rather than caching a failed lookup.
      return code;
    }
    const names = new Map((data ?? []).map((row) => [row.code as string, row.name as string]));
    categoryNameCache = { expiresAt: Date.now() + CATEGORY_NAME_CACHE_TTL_MS, names };
  }
  return categoryNameCache.names.get(code) || code;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ campaignId: string }> }) {
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

    const { campaignId } = await params;
    const campaign = await loadTrainingCampaign(campaignId);
    if (!campaign) {
      return NextResponse.json({ error: 'Training session not found' }, { status: 404 });
    }

    const response: TrainingInterestGetResponse = {
      campaign,
      categoryName: await getCategoryName(campaign.category),
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error('public training-interest GET exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ campaignId: string }> }) {
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

    const { campaignId } = await params;
    // Re-verify the campaign still exists and is a training session server-side
    // — never trust the client's word for it.
    const campaign = await loadTrainingCampaign(campaignId);
    if (!campaign) {
      return NextResponse.json({ error: 'Training session not found' }, { status: 404 });
    }

    const body: unknown = await request.json();
    const bodyObj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const name = typeof bodyObj.name === 'string' ? bodyObj.name.trim() : '';
    const mobile = typeof bodyObj.mobile === 'string' ? bodyObj.mobile.trim() : '';
    const email = typeof bodyObj.email === 'string' ? bodyObj.email.trim() : '';

    if (!name || name.length > MAX_NAME_LENGTH) {
      return NextResponse.json({ error: 'Please enter your name' }, { status: 400 });
    }
    if (!mobile && !email) {
      return NextResponse.json({ error: 'Please enter a mobile number or email address' }, { status: 400 });
    }
    if (mobile && mobile.length > MAX_MOBILE_LENGTH) {
      return NextResponse.json({ error: 'Mobile number is too long' }, { status: 400 });
    }
    if (email && (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email))) {
      return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('training_interest').insert({
      campaign_id: campaignId,
      name,
      mobile: mobile || null,
      email: email || null,
    });
    if (error) {
      console.error('public training-interest POST error:', error);
      return NextResponse.json({ error: 'Failed to register your interest' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('public training-interest POST exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
