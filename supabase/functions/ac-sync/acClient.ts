// ActiveCampaign HTTP adapter — implements lib/registryPipeline's AcPort
// using AC's REST API v3 directly (fetch, no SDK). Deno-only file: uses
// Deno-native fetch and is deployed as part of the ac-sync Edge Function.
//
// VERIFY BEFORE TRUSTING A NEW ENDPOINT/PARAM (this has bitten this
// pipeline repeatedly — see sync.ts's numbered deviations): every
// `filters[...]` param tried on `/contactLists` (`list`, `listid`,
// `updated_since`) turned out to be a silent no-op, only caught by
// testing a future-dated filter against real data and checking it
// actually returned nothing. `/contacts`' `orders[id]=ASC`,
// `filters[updated_after]`, and its pagination stability have all since
// been confirmed the same way (docs/registry-pipeline/OPERATIONS.md,
// 2026-09-01) — but `getContactListMemberships`'s `filters[contact]`
// below has NOT, and correctness deliberately does not depend on it (see
// its own comment). Adjust this file — and only this file — if any AC
// response shape or filter behavior turns out to differ from what's
// documented here; the pure transform/mapping logic in
// lib/registryPipeline does not need to change either way.
//
// Rate limiting: AC enforces 5 req/sec account-wide, shared with other
// integrations (plan Section 3.2). Pacing between calls is the caller's
// responsibility (lib/registryPipeline/sync.ts sleeps between calls); this
// module's job is just to retry correctly on 429 using Retry-After.

import { computeBackoffMs } from '../../../lib/registryPipeline/rateLimiter.ts';
import type { AcPort } from '../../../lib/registryPipeline/ports.ts';
import type { AcContactCore, AcContactListMembership, AcFieldValue, AcContactTag } from '../../../lib/registryPipeline/types.ts';

const AC_API_BASE = Deno.env.get('AC_API_BASE_URL'); // e.g. https://<account>.api-us1.com/api/3
const AC_API_KEY = Deno.env.get('AC_API_KEY'); // shared, full-access, non-rotatable — Edge Function secret only, see plan Section 3.2

const MAX_RETRIES = 5;

function assertConfigured(): void {
  if (!AC_API_BASE || !AC_API_KEY) {
    throw new Error('AC_API_BASE_URL / AC_API_KEY are not set — configure via `supabase secrets set`, never commit them.');
  }
}

async function acFetch(path: string, params: Record<string, string | number>): Promise<unknown> {
  assertConfigured();
  const url = new URL(`${AC_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      headers: { 'Api-Token': AC_API_KEY! },
    });

    if (response.status === 429) {
      if (attempt === MAX_RETRIES) {
        throw new Error(`AC rate limit exceeded after ${MAX_RETRIES} retries: ${path}`);
      }
      const delay = computeBackoffMs(response.headers.get('Retry-After'), attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    if (!response.ok) {
      // Never log response body verbatim — could contain PII. Status + path only.
      throw new Error(`AC API error ${response.status} calling ${path}`);
    }

    return response.json();
  }

  throw new Error(`unreachable: retry loop exhausted for ${path}`);
}

export function createAcClient(): AcPort {
  return {
    async getContactsPage({ updatedSince, limit, offset }) {
      // AC v3: GET /contacts?orders[id]=ASC&limit=&offset=[&filters[updated_after]=<iso>]
      //
      // Replaces the old /contactLists-based discovery entirely (see
      // sync.ts's "Sixth deliberate deviation") after every filters[...]
      // param tried on that endpoint (list, listid, updated_since) was
      // confirmed broken, and its pagination re-fetched some contacts
      // 300+ times because its result-set ordering couldn't be trusted
      // either. CONFIRMED via a live probe (ac_contacts_pagination_probe.js,
      // docs/registry-pipeline/OPERATIONS.md 2026-09-01) before this
      // replaced the old design, not assumed: orders[id]=ASC sorts
      // correctly; the same page (offset=100, limit=20) fetched twice, 8s
      // apart, returned identical contact IDs in identical order — genuine
      // pagination stability, not just a documented claim; and
      // filters[updated_after] correctly returned zero rows for a
      // future-dated filter, unlike every /contactLists filter tried
      // before it.
      const params: Record<string, string | number> = { 'orders[id]': 'ASC', limit, offset };
      if (updatedSince) params['filters[updated_after]'] = updatedSince;

      const body = (await acFetch('/contacts', params)) as {
        contacts?: Array<{ id: string }>;
      };
      const rows = body.contacts ?? [];
      return rows.map((r) => ({ id: r.id }));
    },

    async getContactListMemberships(contactId) {
      // AC v3: GET /contactLists?filters[contact]=<id>
      //
      // `filters[contact]` (scoping by contact rather than by list) has
      // NOT been live-verified the way filters[updated_after] etc. were
      // above — every other filters[...] param tried on THIS SPECIFIC
      // endpoint turned out broken (list, listid, updated_since), so this
      // one is not assumed to work either just because it's a different
      // parameter name on the same broken endpoint. Correctness does not
      // depend on it: sync.ts's caller discards any returned row whose
      // own `.contact` doesn't match what was actually requested, exactly
      // the same defense-in-depth already applied to this endpoint's list
      // scoping (see the Fourth deviation). If this filter turns out to
      // also be a no-op, the only cost is efficiency (a larger unfiltered
      // page to filter client-side), not correctness.
      const body = (await acFetch('/contactLists', { 'filters[contact]': contactId })) as {
        contactLists?: Array<{ contact: string; list: string; status: string }>;
      };
      const rows = body.contactLists ?? [];
      return rows.map(
        (r): AcContactListMembership => ({ contact: r.contact, list: r.list, status: r.status })
      );
    },

    async getContactDetail(contactId) {
      const [contactBody, fieldValuesBody, tagsBody] = await Promise.all([
        acFetch(`/contacts/${contactId}`, {}) as Promise<{
          contact?: { id: string; email: string | null; firstName: string | null; lastName: string | null; phone: string | null; cdate: string | null };
        }>,
        acFetch(`/contacts/${contactId}/fieldValues`, {}) as Promise<{ fieldValues?: Array<{ field: string; value: string }> }>,
        acFetch(`/contacts/${contactId}/contactTags`, {}) as Promise<{ contactTags?: Array<{ tag: string }> }>,
      ]);

      const c = contactBody.contact;
      const core: AcContactCore = {
        id: contactId,
        email: c?.email ?? null,
        firstName: c?.firstName ?? null,
        lastName: c?.lastName ?? null,
        phone: c?.phone ?? null,
        cdate: c?.cdate ?? null,
      };
      const fieldValues: AcFieldValue[] = (fieldValuesBody.fieldValues ?? []).map((fv) => ({
        field: fv.field,
        value: fv.value,
      }));
      // contactTags associates a contact with a tag *ID* only — no name is
      // needed here, since source attribution (sourceAttribution.ts) matches
      // by ac_tag_id against registry.known_source_tags, not by tag name.
      const tags: AcContactTag[] = (tagsBody.contactTags ?? []).map((ct) => ({ id: ct.tag }));

      return { core, fieldValues, tags };
    },
  };
}
