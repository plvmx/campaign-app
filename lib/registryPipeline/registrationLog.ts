// What happened to each form submission ac-sync received — the rules behind
// /registry/manage/registration-log. Added 2026-11-03 after Lorraine reported
// registrations "missing" that were in fact there: a returning person updates
// their existing row (no new row, same registered date) and a Way of Life
// responder form lands in registry.twol_respondents — neither looks like a new
// registration on the Manage grid, and nothing showed that they had arrived.
// Pure and IO-free so the outcome rules are unit tested; the API route does the
// reads.

export type RegistrationLogOutcome =
  | 'new_registrant'
  | 'returning_registrant'
  | 'responder'
  | 'skipped_inactive'
  | 'skipped_excluded'
  | 'error'
  | 'pending'
  | 'no_record';

export interface RegistrationOutcomeInput {
  processedAt: string | null;
  processingError: string | null;
  /** A registry.twol_respondents row was written for this event. */
  hasResponderRow: boolean;
  /** The registrant this event was attached to (via registry.registration_events), if any. */
  registrant: { firstSeenAt: string } | null;
}

/**
 * A registrant row created by this very event has a first_seen_at within a
 * moment of the event being processed. A registrant first seen long before
 * (including everyone loaded from the September CSV, whose first_seen_at is
 * the reload time) was already known — this submission updated their record.
 */
export const NEW_REGISTRANT_WINDOW_MS = 15 * 60 * 1000;

export function deriveRegistrationOutcome(input: RegistrationOutcomeInput): RegistrationLogOutcome {
  const { processedAt, processingError, hasResponderRow, registrant } = input;

  if (processingError) {
    if (processingError.startsWith('skipped: list status not active')) return 'skipped_inactive';
    if (processingError.startsWith('skipped:')) return 'skipped_excluded';
    return 'error';
  }
  if (!processedAt) return 'pending';
  if (hasResponderRow) return 'responder';
  if (registrant) {
    const gap = Math.abs(new Date(processedAt).getTime() - new Date(registrant.firstSeenAt).getTime());
    return Number.isFinite(gap) && gap <= NEW_REGISTRANT_WINDOW_MS ? 'new_registrant' : 'returning_registrant';
  }
  return 'no_record';
}

export const REGISTRATION_LOG_OUTCOME_LABELS: Record<RegistrationLogOutcome, string> = {
  new_registrant: 'New registrant added',
  returning_registrant: 'Already registered — record updated',
  responder: 'Way of Life responder (kept separately, not a registrant)',
  skipped_inactive: 'Skipped — unsubscribed or inactive in ActiveCampaign',
  skipped_excluded: 'Skipped — not a registration form',
  error: 'Error — will be retried',
  pending: 'Waiting to be processed',
  no_record: 'Processed — no record kept',
};

export const REGISTRATION_LOG_OUTCOME_EXPLANATIONS: Record<RegistrationLogOutcome, string> = {
  new_registrant: 'First time this person has registered: a new row was created in the registry.',
  returning_registrant:
    'This person was already in the registry. ActiveCampaign reported their contact as updated (usually because they submitted a form again, but it also reports plain edits), so their details were refreshed — but no new row was added and their original registered date is unchanged, so the count does not go up.',
  responder:
    'Submitted on the Way of Life responder form (a presenter reporting on someone they spoke to). These are stored separately and are not counted as registrants.',
  skipped_inactive: 'ActiveCampaign shows this person as unsubscribed (or otherwise not active), so they are not added.',
  skipped_excluded: 'The contact only carries tags from a form that is not a registration (for example a donation or video-request form).',
  error: 'Something went wrong processing this submission; it will be tried again on the next sync.',
  pending: 'Received from ActiveCampaign but not yet processed — normally cleared by the next sync.',
  no_record: 'Processed without creating or updating a registry record.',
};

export type RegistrationLogView = 'registrations' | 'responders' | 'skipped' | 'all';

export const REGISTRATION_LOG_VIEWS: RegistrationLogView[] = ['registrations', 'responders', 'skipped', 'all'];

export function parseRegistrationLogView(raw: string | null | undefined): RegistrationLogView {
  return REGISTRATION_LOG_VIEWS.find((v) => v === raw) ?? 'registrations';
}

/**
 * The search box feeds a PostgREST `or=(...)` filter, where commas, parentheses,
 * quotes, backslashes and the LIKE wildcards would change the filter's meaning.
 * Strip them rather than escape them: names and emails never need them for a
 * "contains" search.
 */
export function sanitizeSearchTerm(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[,()"'\\%*_]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}
