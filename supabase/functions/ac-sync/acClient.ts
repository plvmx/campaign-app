// ActiveCampaign HTTP adapter — implements lib/registryPipeline's AcPort
// using AC's REST API v3 directly (fetch, no SDK). Deno-only file: uses
// Deno-native fetch and is deployed as part of the ac-sync Edge Function.
//
// VERIFY BEFORE SCHEDULING (brief build order step 2 — "tested against a
// manual invocation before scheduling"): the exact endpoint paths/response
// shapes below are written against AC API v3's documented, stable
// endpoints from memory, not against a live call in this session (no AC
// credentials are available here). Run a manual invocation against a real
// test contact (the same kind of test AC accounts already used to confirm
// Sections 3.3-3.5 of the technical plan) and adjust this file — and only
// this file — if any shape differs. The pure transform/mapping logic in
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
    async getContactListPage({ listId, updatedSince, limit, offset }) {
      // AC v3: GET /contactLists?filters[listid]=<id>&filters[updated_since]=<iso>&limit=&offset=
      //
      // CONFIRMED BROKEN, then fixed: `filters[list]` (the original param
      // name here) does NOT filter — a real invocation against live AC
      // data landed a mix of every list (1, 2, 3, 5) regardless of which
      // listId was requested, including 342+5 records from Lists 3/5,
      // which are supposed to be permanently excluded (plan Section 3.6).
      // Renamed to `filters[listid]`, AC's documented contactLists filter
      // name. Even so, do not rely on this alone — sync.ts's caller now
      // also discards any returned row whose own `.list` doesn't match
      // the requested listId, as defense-in-depth against exactly this
      // class of bug (matches the plan's explicit intent in Section 6.1:
      // "List exclusion is enforced here, not just as a policy decision").
      const params: Record<string, string | number> = { 'filters[listid]': listId, limit, offset };
      if (updatedSince) params['filters[updated_since]'] = updatedSince;

      const body = (await acFetch('/contactLists', params)) as {
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
          contact?: { id: string; email: string | null; firstName: string | null; lastName: string | null; phone: string | null };
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
