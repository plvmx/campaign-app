// Protects registry.registrants.first_name/last_name from being silently
// overwritten by a later ac-sync run against the same email.
//
// Investigated 2026-09-17: Lorraine (a national_admin) test-registered
// using her own real email with placeholder "Test"/"Testing" names to try
// the registration form, and that placeholder name silently became her
// registrant record's permanent name — invisible until she happened to
// search for herself and came up empty. When this was raised, her own
// pushback ruled out any content-based fix: a shared email genuinely can
// belong to more than one real person (a couple registering under one
// household email), and team leaders genuinely do run test submissions —
// there's no reliable way to tell "this is a test" from the name fields
// alone. So the fix isn't detecting test data, it's never letting an
// automatic sync replace a name that's already on file. Once a name is
// known, only a manual, audited edit via /registry/manage (see
// registrantValidation.ts's EDITABLE_REGISTRANT_FIELDS) can change it. A
// currently blank name is still filled in from a fresh sync — that's a
// strict improvement, not an overwrite, and matters for registrants who
// came in with no name at all (e.g. an early CSV row).

function hasName(value: string | null): value is string {
  return value !== null && value.trim() !== '';
}

/**
 * Given the full set of candidate fields an ac-sync upsert is about to
 * write for a registrant row that already exists, returns the fields to
 * actually write — with `first_name`/`last_name` pinned back to their
 * existing stored value whenever that value is already non-blank.
 * Irrelevant for a brand-new row (nothing to protect yet); callers should
 * only apply this on the update path, not the initial insert.
 */
export function protectExistingRegistrantName<T extends { first_name: string | null; last_name: string | null }>(
  candidateFields: T,
  existing: { first_name: string | null; last_name: string | null },
): T {
  return {
    ...candidateFields,
    first_name: hasName(existing.first_name) ? existing.first_name : candidateFields.first_name,
    last_name: hasName(existing.last_name) ? existing.last_name : candidateFields.last_name,
  };
}
