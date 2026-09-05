// Field-inclusion enforcement for the registry pipeline.
// See docs/registry-pipeline/AFJ_PII_Technical_Implementation_Plan.md
// Section 3.4 — field inclusion/exclusion is final, confirmed by AFJ
// leadership. This module is a whitelist, not a blacklist: mapAcFields()
// only ever reads AC custom-field IDs listed in ALLOWED_CUSTOM_FIELD_IDS,
// so a field id that's missing from this list is unreadable by
// construction, not just "not currently read" — a future accidental
// change to AC's forms (e.g. a new field reusing an old excluded ID,
// or someone extending this file carelessly) can't silently reintroduce
// a sensitive field into the registry without a deliberate edit here.

import type { AcFieldValue, MappedRegistrantFields, RawAcContactPayload } from './types.ts';

/**
 * AC custom-field IDs this pipeline is allowed to read (plan Section 3.4).
 * Standard contact fields (name, email, phone) aren't custom fields and
 * are read directly off `contact` — see mapAcFields below.
 *
 * NOT included, deliberately, per plan 3.4 (never add these back without
 * a new AFJ leadership decision): [15] Denomination, [4] Did they say the
 * response prayer?, [12] How much would you like to give?, [13] How can
 * you support AFJ?, [20] Music Leader, [21] Website (an AC *field* ID —
 * unrelated to AC *tag* [21] used for source attribution, see
 * sourceAttribution.ts), [29] Webinar Replay Link, [8] Church, [11]
 * Country, and the wayoflife-responder response-outcome fields.
 *
 * [10]/[28] Church Leader? and [14]/[26] Church Name / What Church do you
 * attend? were ALSO originally excluded here on the same basis — reversed
 * 2026-09-01, Peter confirmed both are now needed.
 */
export const ALLOWED_CUSTOM_FIELD_IDS = {
  /** [6] State (free text) — confirmed canonical, populated on all tested List-1 pages. */
  STATE: '6',
  /** [25] AU State (dropdown) — fallback only; never populated on any tested submission. */
  AU_STATE_FALLBACK: '25',
  /**
   * [30] Post Code. Reverses the original plan Section 3.4/3.5 exclusion
   * ("not currently capturable — data loss identified") — that was a
   * landing-page bug (postcode never reached AC at all, for any
   * submission), not a pipeline decision. Confirmed fixed upstream and
   * live-tested by Peter (two real test registrations, real postcode
   * values landed on field [30], created 2026-08-26 per ac_discovery.js —
   * i.e. the field itself is brand new). Historical registrants will NOT
   * be retroactively backfilled with postcode by AC — this only appears
   * on registrations from ~2026-08-26 onward, so `postcode` being null is
   * expected and normal for anyone registered before then.
   */
  POSTCODE: '30',
  /** [9] Interested in training? — confirmed live/populated per plan 3.4. Promoted to registry.registrants.interested_in_training (2026-09-01, per Peter). */
  INTERESTED_IN_TRAINING: '9',
  /**
   * [28] Are you a church leader? (dropdown, newer form) / [10] Church
   * Leader? (hidden, older form) — same old/new pairing already seen for
   * State [6]/[25] and training [9]/[27]. Reverses the original plan 3.4
   * exclusion ("Sensitive-adjacent; leadership decision") — confirmed by
   * Peter 2026-09-01 that this is now needed.
   */
  CHURCH_LEADER: '28',
  CHURCH_LEADER_FALLBACK: '10',
  /**
   * [26] What Church do you attend? (newer) / [14] Church Name (older) —
   * same pairing pattern. Reverses the original plan 3.4 exclusion
   * ("Confirmed by AFJ leadership") — confirmed by Peter 2026-09-01 that
   * this is now needed.
   */
  CHURCH_NAME: '26',
  CHURCH_NAME_FALLBACK: '14',
  /**
   * Confirmed live/populated and included per plan 3.4, but registry.registrants
   * (plan Section 5) has no column for these yet — they're preserved untouched
   * in staging.ac_events.raw_payload and simply not promoted to the canonical
   * table in this phase. Add registrants columns in a future migration if an
   * operational need for them emerges; do not read them further than that
   * without doing so (there's nowhere to put the mapped value yet).
   */
  BOTJ_WEBINAR_REGO_DATE: '23',
  BOTJ_WEBINAR_SESSION: '24',
} as const;

function findFieldValue(fieldValues: readonly AcFieldValue[], fieldId: string): string | null {
  const match = fieldValues.find((fv) => fv.field === fieldId);
  const value = match?.value?.trim();
  return value ? value : null;
}

/**
 * Maps a raw AC contact payload to the fields the registry actually stores.
 * This is the sole place allowed to read AC custom fields — see
 * ALLOWED_CUSTOM_FIELD_IDS above. Never index `fieldValues` by an ID that
 * isn't in that whitelist.
 */
export function mapAcFields(payload: RawAcContactPayload): MappedRegistrantFields {
  const { contact, fieldValues } = payload;

  const state =
    findFieldValue(fieldValues, ALLOWED_CUSTOM_FIELD_IDS.STATE) ??
    findFieldValue(fieldValues, ALLOWED_CUSTOM_FIELD_IDS.AU_STATE_FALLBACK);

  const churchLeader =
    findFieldValue(fieldValues, ALLOWED_CUSTOM_FIELD_IDS.CHURCH_LEADER) ??
    findFieldValue(fieldValues, ALLOWED_CUSTOM_FIELD_IDS.CHURCH_LEADER_FALLBACK);

  const churchName =
    findFieldValue(fieldValues, ALLOWED_CUSTOM_FIELD_IDS.CHURCH_NAME) ??
    findFieldValue(fieldValues, ALLOWED_CUSTOM_FIELD_IDS.CHURCH_NAME_FALLBACK);

  return {
    firstName: contact.firstName?.trim() || null,
    lastName: contact.lastName?.trim() || null,
    email: contact.email?.trim() || null,
    phoneRaw: contact.phone?.trim() || null,
    state,
    postcode: findFieldValue(fieldValues, ALLOWED_CUSTOM_FIELD_IDS.POSTCODE),
    registeredAt: contact.cdate?.trim() || null,
    interestedInTraining: findFieldValue(fieldValues, ALLOWED_CUSTOM_FIELD_IDS.INTERESTED_IN_TRAINING),
    churchLeader,
    churchName,
  };
}
