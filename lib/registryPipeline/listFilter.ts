// List-scoping predicates for the registry pipeline.
// See docs/registry-pipeline/AFJ_PII_Technical_Implementation_Plan.md
// Sections 3.6 and 6.1/6.2.

/**
 * AC lists that are permanently excluded from the registry: List 3
 * ("Business Life") and List 5 ("Tony Mclennan") — see plan Section 3.6.
 * Enforced at the sync step (before a contact ever reaches staging), not
 * just in the transform, as defense-in-depth: List 5 contacts include
 * sensitive financial-intent field data, so it should never be one
 * accidental query away from entering the registry (plan Section 6.1).
 */
export const EXCLUDED_LIST_IDS: readonly string[] = ['3', '5'];

/** True if this AC list ID must never be synced into the registry. */
export function isExcludedList(listId: string): boolean {
  return EXCLUDED_LIST_IDS.includes(listId);
}

/**
 * AC's `contactLists` status for "actively subscribed". Confirmed via real
 * test data that status can be a value other than '1' (e.g. '3', seen on a
 * bounced test email) — anything else must be skipped rather than assumed
 * to be an active registrant (plan Section 6.2 / Section 10 open question).
 */
const ACTIVE_LIST_STATUS = '1';

/** True if this AC contactLists membership status counts as an active registrant. */
export function isActiveListStatus(status: string | null | undefined): boolean {
  return status === ACTIVE_LIST_STATUS;
}
