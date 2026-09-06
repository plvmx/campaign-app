/**
 * Registry portal — "Recent Registrations" temporary reconciliation view.
 *
 * Live, on-demand AC lookup (no staging/registry table writes, no
 * persistence at all) for genuine List 1/2 registrants created on or
 * after REGISTRATIONS_RELOAD_CUTOFF — the same cutoff Lorraine's manual
 * spreadsheet reload will eventually use (see
 * docs/registry-pipeline/OPERATIONS.md's "Strategic pivot" section).
 * This screen exists only because that full reload + ongoing
 * reconciliation isn't built yet; expect it to be replaced once it is.
 *
 * Applies the same List 3/5 exclusion, active-membership check, and
 * MailChimp-import-only exclusion as the real sync pipeline (reusing
 * lib/registryPipeline/listFilter.ts + tagExclusion.ts + fieldMap.ts) —
 * deliberately not a simpler/broader "every AC contact touched since X",
 * so this doesn't show a national admin anything the real pipeline
 * wouldn't also treat as a genuine registrant.
 *
 * Requires AC_API_BASE_URL / AC_API_KEY as Vercel environment variables
 * (see lib/registryPipeline/acReadOnlyClient.ts's header comment) — the
 * same credential already set as a Supabase Edge Function secret for
 * ac-sync, added here a second time because this runs in a different
 * runtime.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { verifyRegistryAdminRequest } from '@/lib/registryServerAuth';
import { createAcReadOnlyClient } from '@/lib/registryPipeline/acReadOnlyClient';
import { isExcludedList, isActiveListStatus } from '@/lib/registryPipeline/listFilter';
import { isExcludedSourceOnly } from '@/lib/registryPipeline/tagExclusion';
import { matchSourceTag } from '@/lib/registryPipeline/sourceAttribution';
import { mapAcFields } from '@/lib/registryPipeline/fieldMap';
import { normalizePhone } from '@/lib/registryPipeline/phone';
import { REQUEST_PACING_MS, sleep } from '@/lib/registryPipeline/rateLimiter';
import type { KnownSourceTag } from '@/lib/registryPipeline/types';
import type { RecentRegistration } from '@/lib/registryPipeline/recentRegistrationTypes';

// Lorraine's spreadsheet ("Peters Interim AFJ Soulwinners List") covers
// registrations up to this date — the max Regd date actually found in it,
// confirmed 2026-09-05 (its filename says "22 Sept 2026", which is a typo
// for this). Update this if a newer spreadsheet with a later cutoff
// arrives, and again once the real reload+reconciliation ships (at which
// point this whole route is expected to be retired).
const REGISTRATIONS_RELOAD_CUTOFF = '2026-08-22T00:00:00Z';

const PAGE_SIZE = 100;

// Generous — a full AC pull with a list-membership pre-check plus a
// 3-call detail fetch per qualifying contact, each paced against AC's
// shared 5 req/sec limit, is not fast. This is a low-traffic, occasional
// admin tool (see file header), not something to over-optimize before
// there's evidence it needs it.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const verified = await verifyRegistryAdminRequest(supabaseAdmin, token);
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const ac = createAcReadOnlyClient();

    const { data: knownTagsRows, error: knownTagsError } = await supabaseAdmin
      .schema('registry')
      .from('known_source_tags')
      .select('ac_tag_id, tag_name, source_label');
    if (knownTagsError) throw knownTagsError;
    const knownTags = (knownTagsRows ?? []) as KnownSourceTag[];

    // Discover every AC contact created since the cutoff (confirmed
    // reliable filter — see acReadOnlyClient.ts's header comment).
    const contactIds: string[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await ac.contactsCreatedSince({ createdAfter: REGISTRATIONS_RELOAD_CUTOFF, limit: PAGE_SIZE, offset });
      if (page.length === 0) break;
      contactIds.push(...page.map((c) => c.id));
      await sleep(REQUEST_PACING_MS);
    }

    const results: RecentRegistration[] = [];

    for (const contactId of contactIds) {
      const memberships = await ac.getContactListMemberships(contactId);
      await sleep(REQUEST_PACING_MS);

      const qualifyingMembership = memberships.find(
        (m) => m.contact === contactId && !isExcludedList(m.list) && isActiveListStatus(m.status),
      );
      if (!qualifyingMembership) continue;

      const detail = await ac.getContactDetail(contactId);
      await sleep(REQUEST_PACING_MS);

      const matchedKnownSourceTag = matchSourceTag(detail.tags, knownTags) !== null;
      if (isExcludedSourceOnly(detail.tags, matchedKnownSourceTag)) continue;

      const mapped = mapAcFields({
        contact: detail.core,
        fieldValues: detail.fieldValues,
        tags: detail.tags,
        listMembership: qualifyingMembership,
      });

      results.push({
        firstName: mapped.firstName,
        lastName: mapped.lastName,
        email: mapped.email,
        phone: normalizePhone(mapped.phoneRaw),
        state: mapped.state,
        postcode: mapped.postcode,
        registeredAt: mapped.registeredAt,
      });
    }

    return NextResponse.json({ registrations: results, cutoff: REGISTRATIONS_RELOAD_CUTOFF });
  } catch (err) {
    console.error('[registry/recent-registrations] failed:', err);
    return NextResponse.json({ error: 'Failed to fetch recent registrations from ActiveCampaign' }, { status: 502 });
  }
}
