// Node/Next.js AC HTTP adapter — for read-only, on-demand lookups from a
// Next.js API route (currently just app/api/registry/recent-registrations),
// as opposed to supabase/functions/ac-sync/acClient.ts, the Deno
// equivalent used by the scheduled/backfill sync pipeline. Same
// confirmed-working nested-resource endpoints for list membership/detail
// — see that file's header comment for the incident history establishing
// which AC endpoints/filters are actually reliable.
//
// Deliberately its OWN interface (AcReadOnlyPort), not a second
// implementation of lib/registryPipeline/ports.ts's AcPort: that
// interface's getContactsPage is documented as using
// filters[updated_after] (the sync pipeline's incremental-cursor
// semantics). This adapter's contactsCreatedSince() intentionally uses
// filters[created_after] instead — "show me who registered since date X",
// not "show me who changed since the last run" — a genuinely different
// filter and a different meaning; reusing AcPort's shape here would make
// that difference invisible to a future reader.
//
// Deliberately not unit tested, same as acClient.ts/db.ts — a thin HTTP
// adapter with no decision logic of its own; the actual business logic
// (list/tag exclusion, field mapping) lives in this same directory and is
// tested there. Requires AC_API_BASE_URL / AC_API_KEY as Vercel
// environment variables — the same credential already configured as a
// Supabase Edge Function secret for ac-sync, added a second place because
// this route runs in a different runtime.

import { computeBackoffMs } from './rateLimiter';
import type { AcContactCore, AcContactListMembership, AcFieldValue, AcContactTag } from './types';

const AC_API_BASE = process.env.AC_API_BASE_URL;
const AC_API_KEY = process.env.AC_API_KEY;

const MAX_RETRIES = 5;

export interface AcReadOnlyPort {
  /** One page of AC contacts created on or after `createdAfter` (filters[created_after], confirmed working), ordered ascending by contact id. Empty array means the caller has reached the end. */
  contactsCreatedSince(params: { createdAfter: string; limit: number; offset: number }): Promise<{ id: string }[]>;
  /** Every list-membership row for ONE contact — see acClient.ts for why this must be the nested /contacts/{id}/contactLists path, not the standalone /contactLists endpoint. */
  getContactListMemberships(contactId: string): Promise<AcContactListMembership[]>;
  /** Core fields + custom fieldValues + tags for one contact, by AC contact ID. */
  getContactDetail(contactId: string): Promise<{ core: AcContactCore; fieldValues: AcFieldValue[]; tags: AcContactTag[] }>;
}

function assertConfigured(): void {
  if (!AC_API_BASE || !AC_API_KEY) {
    throw new Error('AC_API_BASE_URL / AC_API_KEY are not set as Vercel environment variables.');
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

export function createAcReadOnlyClient(): AcReadOnlyPort {
  return {
    async contactsCreatedSince({ createdAfter, limit, offset }) {
      const body = (await acFetch('/contacts', {
        'orders[id]': 'ASC',
        limit,
        offset,
        'filters[created_after]': createdAfter,
      })) as { contacts?: Array<{ id: string }> };
      return (body.contacts ?? []).map((r) => ({ id: r.id }));
    },

    async getContactListMemberships(contactId) {
      const body = (await acFetch(`/contacts/${contactId}/contactLists`, {})) as {
        contactLists?: Array<{ contact: string; list: string; status: string }>;
      };
      return (body.contactLists ?? []).map(
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
      const fieldValues: AcFieldValue[] = (fieldValuesBody.fieldValues ?? []).map((fv) => ({ field: fv.field, value: fv.value }));
      const tags: AcContactTag[] = (tagsBody.contactTags ?? []).map((ct) => ({ id: ct.tag }));

      return { core, fieldValues, tags };
    },
  };
}
