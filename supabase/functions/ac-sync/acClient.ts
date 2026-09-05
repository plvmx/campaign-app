// ActiveCampaign HTTP adapter — implements lib/registryPipeline's AcPort
// using AC's REST API v3 directly (fetch, no SDK). Deno-only file: uses
// Deno-native fetch and is deployed as part of the ac-sync Edge Function.
//
// VERIFY BEFORE TRUSTING A NEW ENDPOINT/PARAM (this has bitten this
// pipeline repeatedly — see sync.ts's numbered deviations): every
// `filters[...]` param tried on the standalone `/contactLists?filters[...]`
// endpoint (`list`, `listid`, `updated_since`, and — 2026-09-01 —
// `contact`) turned out to be a silent no-op, each caught a different way
// (the first three by testing a future-dated filter against real data and
// checking it actually returned nothing; `filters[contact]` by noticing a
// real production sweep of 1,120 known contacts found only 2 genuine
// matches, then confirming live that four different contact IDs all
// returned the exact same fixed page regardless of which was requested).
// AC's *nested*-resource paths (`/contacts/{id}/fieldValues`,
// `/contacts/{id}/contactTags`, `/contacts/{id}/contactLists`) have never
// failed this way — every one tested live has worked correctly. `/contacts`'
// own top-level `orders[id]=ASC`, `filters[updated_after]`, and pagination
// stability have also been confirmed live (docs/registry-pipeline/OPERATIONS.md).
// Adjust this file — and only this file — if any AC response shape or
// filter behavior turns out to differ from what's documented here; the
// pure transform/mapping logic in lib/registryPipeline does not need to
// change either way.
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
      // AC v3: GET /contacts/<id>/contactLists
      //
      // CONFIRMED BROKEN, then fixed (2026-09-01): `filters[contact]` on
      // the standalone `/contactLists?filters[...]` endpoint (the
      // original approach here) is a FOURTH no-op filter on that
      // endpoint, joining `list`, `listid`, and `updated_since` — proven
      // via a live probe (ac_contactlists_by_contact_probe.js) that
      // requesting contacts 6, 10, 11, and 12 all returned the exact
      // same fixed 20-row page, completely ignoring which contact was
      // asked for. Unlike the other three (which returned MORE than
      // requested), this one effectively returns close to nothing
      // genuine for most contacts — the defense-in-depth client-side
      // `.contact` check in sync.ts only ever matched by coincidence,
      // when a requested id happened to already be one of that fixed
      // page's ~20 rows. Confirmed via the same probe: a real production
      // batch swept AC contact IDs 6-1120 (known from history to include
      // 1,099 genuine List 1/2 members) and found only 2.
      //
      // Fixed by switching to AC's nested-resource path instead — the
      // same pattern already used successfully elsewhere in this file
      // (`/contacts/{id}/fieldValues`, `/contacts/{id}/contactTags`).
      // The same probe confirmed this one IS genuinely scoped: contacts
      // 6, 10, 11, and 12 each returned a different, correct result
      // specific to that one contact. The defense-in-depth `.contact`
      // check in sync.ts is kept regardless — cheap insurance, not
      // something to remove just because this path checked out live.
      const body = (await acFetch(`/contacts/${contactId}/contactLists`, {})) as {
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
