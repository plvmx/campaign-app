// Editable-field whitelist + value validation for admin corrections made
// from the /registry/manage console's View/Edit toggle. Shared by the page
// (app/registry/manage/page.tsx, drives the inline inputs) and the API
// route (app/api/registry/manage-record/route.ts, re-validates server-side
// rather than trusting the client) — kept pure so both can rely on exactly
// the same rules without duplicating them.
import { AUSTRALIAN_STATES } from '../constants';

/**
 * Only these registry.registrants fields can be hand-edited from the
 * console. Email/phone are deliberately excluded — they're the pipeline's
 * own identity/dedup keys (email is registry.registrants' unique index and
 * ac-sync's upsert conflict target; phone is the documented fallback match
 * for email-less rows) — editing either here risks splitting one real
 * person into two rows on a future sync. Date registered is a fact about
 * when they registered, not something to correct.
 *
 * `nfc` (No Further Contact) added 2026-09-25 — Peter needed a manual way
 * to flag it while cross-referencing Lorraine's updated spreadsheet found
 * cases neither ac-sync nor the CSV backfill could resolve on their own
 * (see docs/registry-pipeline/OPERATIONS.md's entry of that date).
 */
export const EDITABLE_REGISTRANT_FIELDS = ['firstName', 'lastName', 'state', 'postcode', 'nfc'] as const;
export type EditableRegistrantField = (typeof EDITABLE_REGISTRANT_FIELDS)[number];

/** camelCase field name -> the actual registry.registrants column it writes. */
export const EDITABLE_FIELD_COLUMNS: Record<EditableRegistrantField, string> = {
  firstName: 'first_name',
  lastName: 'last_name',
  state: 'state',
  postcode: 'postcode',
  nfc: 'nfc',
};

export function isEditableRegistrantField(value: string): value is EditableRegistrantField {
  return (EDITABLE_REGISTRANT_FIELDS as readonly string[]).includes(value);
}

/**
 * Display label for a registry.registrant_edits row's `field` column, which
 * stores the actual DB column name (e.g. 'first_name'), not the camelCase
 * key above — keyed by that stored value so /registry/manage/edit-log can
 * label a historical row without re-deriving it from EDITABLE_FIELD_COLUMNS.
 */
export const EDITABLE_FIELD_LABELS: Record<string, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  state: 'State',
  postcode: 'Postcode',
  nfc: 'NFC (No Further Contact)',
};

/** Australian postcodes are exactly 4 digits. Blank/null is valid too — postcode is optional, and this is how a national admin clears a bad one. */
export function isValidAustralianPostcode(value: string | null): boolean {
  if (value === null) return true;
  const trimmed = value.trim();
  if (trimmed === '') return true;
  return /^\d{4}$/.test(trimmed);
}

/** State is edited via a constrained dropdown, not free text, so this only needs to confirm the value is one of the real codes (or blank, to clear it) — never re-derives the CSV reload's looser free-text normalization. */
export function isValidRegistrantState(value: string | null): boolean {
  if (value === null || value.trim() === '') return true;
  return (AUSTRALIAN_STATES as readonly string[]).includes(value);
}

/** nfc is edited via a fixed Yes/blank control, matching the column's own 'Yes'/null-only convention elsewhere in this pipeline (csvRegistrantTransform.ts, tagDerivedFields.ts) — never a recorded 'No'. */
export function isValidNfcFlag(value: string | null): boolean {
  return value === null || value.trim() === '' || value === 'Yes';
}

/** Dispatches to the right rule for whichever field is being edited. Name fields have no format constraint beyond what the caller trims. */
export function isValidRegistrantFieldValue(field: EditableRegistrantField, value: string | null): boolean {
  switch (field) {
    case 'postcode': return isValidAustralianPostcode(value);
    case 'state': return isValidRegistrantState(value);
    case 'nfc': return isValidNfcFlag(value);
    case 'firstName':
    case 'lastName':
      return true;
  }
}
