import { describe, it, expect } from 'vitest';
import {
  deriveRegistrationOutcome,
  parseRegistrationLogView,
  sanitizeSearchTerm,
  REGISTRATION_LOG_OUTCOME_LABELS,
  REGISTRATION_LOG_OUTCOME_EXPLANATIONS,
  type RegistrationOutcomeInput,
} from '../registrationLog';

const processed = '2026-10-31T12:00:08Z';

function input(overrides: Partial<RegistrationOutcomeInput> = {}): RegistrationOutcomeInput {
  return { processedAt: processed, processingError: null, hasResponderRow: false, registrant: null, ...overrides };
}

describe('deriveRegistrationOutcome', () => {
  it('is a new registrant when the registry row was first seen at the time the event was processed', () => {
    expect(deriveRegistrationOutcome(input({ registrant: { firstSeenAt: '2026-10-31T12:00:07Z' } }))).toBe('new_registrant');
  });

  it('is a returning registrant when the row was first seen long before (the 31 Oct case: an existing 2025 contact re-submitting)', () => {
    expect(deriveRegistrationOutcome(input({ registrant: { firstSeenAt: '2026-09-08T05:37:39Z' } }))).toBe('returning_registrant');
  });

  it('treats a CSV-loaded registrant first synced much later as returning, not new', () => {
    // first_seen_at is the reload time for CSV rows, however recent the person's own registration was.
    expect(deriveRegistrationOutcome(input({ registrant: { firstSeenAt: '2026-09-09T12:00:00Z' } }))).toBe('returning_registrant');
  });

  it('is a responder when a twol_respondents row was written, even with no registrant', () => {
    expect(deriveRegistrationOutcome(input({ hasResponderRow: true }))).toBe('responder');
  });

  it('classifies an unsubscribed / inactive-list skip', () => {
    expect(deriveRegistrationOutcome(input({ processingError: 'skipped: list status not active' }))).toBe('skipped_inactive');
  });

  it('classifies an excluded-source skip', () => {
    expect(
      deriveRegistrationOutcome(input({ processingError: 'skipped: excluded source tag only (no recognized registration funnel)' })),
    ).toBe('skipped_excluded');
  });

  it('classifies any other processing error as an error', () => {
    expect(deriveRegistrationOutcome(input({ processingError: 'permission denied for sequence' }))).toBe('error');
  });

  it('is pending when the event has not been processed', () => {
    expect(deriveRegistrationOutcome(input({ processedAt: null }))).toBe('pending');
  });

  it('is "no record" when it was processed cleanly but produced nothing', () => {
    expect(deriveRegistrationOutcome(input())).toBe('no_record');
  });

  it('checks the error before pending, so an errored event is never shown as merely waiting', () => {
    expect(deriveRegistrationOutcome(input({ processedAt: null, processingError: 'boom' }))).toBe('error');
  });
});

describe('outcome copy', () => {
  it('has a label and an explanation for every outcome', () => {
    for (const outcome of Object.keys(REGISTRATION_LOG_OUTCOME_LABELS) as (keyof typeof REGISTRATION_LOG_OUTCOME_LABELS)[]) {
      expect(REGISTRATION_LOG_OUTCOME_LABELS[outcome]).toBeTruthy();
      expect(REGISTRATION_LOG_OUTCOME_EXPLANATIONS[outcome]).toBeTruthy();
    }
  });
});

describe('parseRegistrationLogView', () => {
  it('accepts the known views', () => {
    expect(parseRegistrationLogView('responders')).toBe('responders');
    expect(parseRegistrationLogView('skipped')).toBe('skipped');
    expect(parseRegistrationLogView('all')).toBe('all');
  });

  it('defaults to registrations for anything else', () => {
    expect(parseRegistrationLogView(null)).toBe('registrations');
    expect(parseRegistrationLogView('nonsense')).toBe('registrations');
  });
});

describe('sanitizeSearchTerm', () => {
  it('strips characters that would change a PostgREST or-filter', () => {
    expect(sanitizeSearchTerm('a,b)c(d"e\'f%g*h_i')).toBe('a b c d e f g h i');
  });

  it('trims, collapses whitespace and caps the length', () => {
    expect(sanitizeSearchTerm('  jan   michel ')).toBe('jan michel');
    expect(sanitizeSearchTerm('x'.repeat(200))).toHaveLength(60);
  });

  it('returns empty for null / undefined', () => {
    expect(sanitizeSearchTerm(null)).toBe('');
    expect(sanitizeSearchTerm(undefined)).toBe('');
  });
});
