// Shared types for the AFJ registry pipeline (staging.ac_events / registry.*).
// See docs/registry-pipeline/AFJ_PII_Technical_Implementation_Plan.md.
//
// These are plain data shapes with no Supabase or Deno dependency, so they
// can be imported both by lib/registryPipeline (Node/Vitest) and by the
// ac-sync Edge Function (Deno) via a relative import.

/** A single AC custom-field value, as returned by GET /contacts/{id}/fieldValues. */
export interface AcFieldValue {
  field: string; // AC field ID, e.g. '6' for State
  value: string;
}

/** An AC tag ID associated with a contact, as returned by GET /contacts/{id}/contactTags. */
export interface AcContactTag {
  id: string; // AC tag ID, e.g. '21'
}

/** AC list membership status for one contact on one list (from the contactLists relation). */
export interface AcContactListMembership {
  contact: string; // AC contact ID
  list: string; // AC list ID
  status: string; // '1' = active; anything else (e.g. '3' = bounced) is not an active registrant
}

/** Core AC contact fields, as returned by GET /contacts (or /contacts/{id}). */
export interface AcContactCore {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}

/**
 * The assembled, still-raw shape ac-sync stores in staging.ac_events.raw_payload
 * — one contact's core fields + fieldValues + tags + the list membership it
 * was pulled under, before any field-inclusion filtering or normalization.
 */
export interface RawAcContactPayload {
  contact: AcContactCore;
  fieldValues: AcFieldValue[];
  tags: AcContactTag[];
  listMembership: AcContactListMembership;
}

/** Row shape of registry.known_source_tags, fetched live each transform run. */
export interface KnownSourceTag {
  ac_tag_id: string;
  tag_name: string;
  source_label: string;
}

/** Output of map_ac_fields() — only ever the included fields (plan Section 3.4). */
export interface MappedRegistrantFields {
  fullName: string | null;
  email: string | null;
  phoneRaw: string | null;
  state: string | null;
  /** [30] Post Code — only present on registrations from ~2026-08-26 onward; null for historical registrants is expected, not missing data. */
  postcode: string | null;
}
