// Tag-derived registrant fields for the registry pipeline — distinct from
// sourceAttribution.ts (which fields registration_events.source_tag) and
// tagExclusion.ts (which drops a contact from the registry entirely).
// This module fills specific registry.registrants columns straight from a
// contact's tag set, for signals that turned out NOT to be AC custom
// fields at all despite looking like they should be.
//
// Traced live against the AC API (2026-09-15) after Peter reported three
// fields ("Attended", "CODE", "Date") he believed existed on named AC
// field groups ("BOTJ Webinar", "wayoflife") in Jordan's tracking
// spreadsheet. A query of AC's actual custom fields (28 total, confirmed
// exhaustive) found none of those names. Cross-referencing live AC contact
// records — fieldValues, tags, and per-tag `cdate` from
// GET /contacts/{id}/contactTags — against Jordan's spreadsheet traced all
// three to tags instead:
//
//   webinar_attended ("W/Done" in Lorraine's CSV) <- tag 60 "CAMPAIGN:
//     Bringing Others Webinar: Attended" (confirmed live on a contact
//     whose sheet row said W/Done=Yes) vs tag 56 "...: Missed" (the paired
//     counterpart in AC's own matched 56-61 tag set — name-inferred, not
//     yet confirmed applied to any actual contact; Jordan's own tracking
//     data shows Attended as Yes-or-blank in every sampled row, so this
//     tag may simply not be in active use). Consequence: expect this
//     derivation to realistically only ever produce 'Yes'/null from a live
//     AC sync — an explicit 'No' will likely only ever come from the CSV
//     backfill (scripts/backfill_webinar_and_code_fields_from_csv.ts),
//     which is not a bug in this function.
//
//   code_of_conduct_agreed ("Code" in the CSV) <- presence of tag 48
//     "CAMPAIGN: TWOL Sept 2019 Register" — an oddly-named but
//     already-seeded registry.known_source_tags row (source_label
//     'wayoflife_interest') for the /thewayoflife/ registration page.
//     Peter confirmed (2026-09-15) that "Code" means exactly "this
//     registrant has a genuine /thewayoflife/ registration" — there is no
//     separate Code-of-Conduct field or tag anywhere in AC (confirmed:
//     zero hits). Deliberately checked as raw presence in the full tag
//     array, NOT via sourceAttribution.matchSourceTag, whose "first
//     matching tag in the array wins" behaviour is the wrong question here
//     — a contact who registered via /thewayoflife/ at some point still
//     agreed to the Code even if a later event's chosen source_tag is
//     something else.
//
//   code_of_conduct_agreed_at ("Date Agreed" in the CSV) <- that same
//     tag 48's own `cdate` — when AC actually applied the tag, not the
//     contact's own cdate (registered_at), which was confirmed live to
//     differ from the tag's cdate by as much as ~6 months on a real
//     example.
//
// Never writes 'No' for code_of_conduct_agreed — absence of tag 48 is "no
// evidence", not a recorded refusal, matching how unsubscribed/nfc are
// 'Yes'/null-only elsewhere in this table.

import type { AcContactTag } from './types.ts';

export const WEBINAR_ATTENDED_TAG_ID = '60'; // CAMPAIGN: Bringing Others Webinar: Attended
export const WEBINAR_MISSED_TAG_ID = '56'; // CAMPAIGN: Bringing Others Webinar: Missed (name-inferred, not confirmed live)
export const CODE_OF_CONDUCT_TAG_ID = '48'; // CAMPAIGN: TWOL Sept 2019 Register — the /thewayoflife/ funnel tag

export interface TagDerivedRegistrantFields {
  webinarAttended: 'Yes' | 'No' | null;
  codeOfConductAgreed: 'Yes' | null;
  codeOfConductAgreedAt: string | null;
}

/**
 * Derives webinar_attended / code_of_conduct_agreed / code_of_conduct_agreed_at
 * from a contact's current AC tag set. Pure and total — every input
 * produces a result, no field ever throws.
 */
export function deriveTagFields(contactTags: readonly AcContactTag[]): TagDerivedRegistrantFields {
  const webinarAttended = contactTags.some((t) => t.id === WEBINAR_ATTENDED_TAG_ID)
    ? 'Yes'
    : contactTags.some((t) => t.id === WEBINAR_MISSED_TAG_ID)
      ? 'No'
      : null;

  const codeTag = contactTags.find((t) => t.id === CODE_OF_CONDUCT_TAG_ID);

  return {
    webinarAttended,
    codeOfConductAgreed: codeTag ? 'Yes' : null,
    codeOfConductAgreedAt: codeTag?.cdate ?? null,
  };
}

const AC_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)?)?$/;

/**
 * Accepts only an unambiguous AC date/datetime value ('YYYY-MM-DD',
 * optionally with a time suffix, as AC's own fields and tag `cdate`
 * actually return) — anything else (blank, a stray note, junk) becomes
 * null, so a malformed value from AC can never fail a staging write.
 */
export function normalizeAcDate(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value || !AC_DATE_RE.test(value)) return null;
  return value;
}
