import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePhone } from '@/lib/registryPipeline/phone';

/**
 * "Is this person registered?" — a leader-facing yes/no check against
 * registry.registrants, backing POST /api/leader/check-registration and the
 * /app/check-registration screen (linked from a leader's My Admin page).
 *
 * The registry holds personal details of ~9,000 people that a plain leader
 * has no other access to (the /registry portal is national-admin + MFA only),
 * so this is deliberately a narrow oracle rather than a search:
 * - A contact detail (email and/or mobile) is REQUIRED and matched exactly.
 *   A name on its own never matches anything — names aren't unique, and a
 *   name-only search would let anyone browse the registry by guessing.
 * - Nothing stored in the registry is ever returned. The answer is one of
 *   three statuses plus which of the caller's OWN typed contact details
 *   matched; the stored name, state, other contact detail etc. stay put.
 * - An unsubscribed / No Further Contact registrant still reads as
 *   "registered" (they are) with no hint of either flag.
 *
 * Takes an injected client (always supabaseAdmin in practice — a leader's own
 * session has no access to the registry schema at all), same DI pattern as
 * sessionAccessService.ts, for testability with supabaseMock.ts.
 */

/**
 * - `registered`: a registrant has this email/mobile AND this name.
 * - `name_mismatch`: a registrant has this email/mobile, but under a different
 *   name — a shared household email, a nickname/misspelling, or test data
 *   (the registry is one row per email, so a couple sharing an address only
 *   ever has one of them on file). Worth a human follow-up either way.
 * - `not_registered`: nobody in the registry has this email or mobile.
 */
export type RegistrationStatus = 'registered' | 'name_mismatch' | 'not_registered';

export type RegistrationMatchField = 'email' | 'mobile';

export interface RegistrationCheckInput {
  firstName: string;
  lastName: string;
  email: string | null;
  mobile: string | null;
}

export interface RegistrationCheckResult {
  status: RegistrationStatus;
  /** Which of the typed contact details a registrant was found under. */
  matchedOn: RegistrationMatchField[];
}

/** The admin lookup's input: contact details only, at least one of them. */
export type ContactLookupInput = Pick<RegistrationCheckInput, 'email' | 'mobile'>;

export interface ContactLookupResult {
  registered: boolean;
  /** Which of the typed contact details a registrant was found under. */
  matchedOn: RegistrationMatchField[];
}

export type ParsedContactLookupInput =
  | { ok: true; input: ContactLookupInput }
  | { ok: false; error: string };

export type ParsedRegistrationCheckInput =
  | { ok: true; input: RegistrationCheckInput }
  | { ok: false; error: string };

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Deliberately looser than lib/validation.ts's isValidMobile (04XX only):
// registry phones are stored E.164 and a few are landlines or were typed with
// a +61 prefix, all of which normalizePhone() below handles.
const MIN_PHONE_DIGITS = 8;
const MAX_PHONE_DIGITS = 15;

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** The message for the first problem with a (trimmed) email/mobile pair, or null if usable. */
function validateContactDetails(email: string, mobile: string): string | null {
  if (!email && !mobile) return 'Enter an email address or a mobile number (or both).';
  if (email && (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email))) {
    return 'That email address does not look right.';
  }
  if (mobile) {
    const digits = mobile.replace(/\D/g, '').length;
    if (digits < MIN_PHONE_DIGITS || digits > MAX_PHONE_DIGITS) {
      return 'That mobile number does not look right.';
    }
  }
  return null;
}

/**
 * Validates and cleans a check request. Shared by the page (inline errors
 * before submitting) and the API route (the browser's copy is never trusted).
 */
export function parseRegistrationCheckInput(body: unknown): ParsedRegistrationCheckInput {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid request' };
  const b = body as Record<string, unknown>;

  const firstName = asTrimmedString(b.firstName);
  const lastName = asTrimmedString(b.lastName);
  const email = asTrimmedString(b.email);
  const mobile = asTrimmedString(b.mobile);

  if (!firstName || !lastName) return { ok: false, error: 'Enter both a first name and a last name.' };
  if (firstName.length > MAX_NAME_LENGTH || lastName.length > MAX_NAME_LENGTH) {
    return { ok: false, error: 'That name is too long.' };
  }
  const contactError = validateContactDetails(email, mobile);
  if (contactError) return { ok: false, error: contactError };

  return { ok: true, input: { firstName, lastName, email: email || null, mobile: mobile || null } };
}

/**
 * Validates and cleans a contact-only lookup (the admin version — no name).
 * Shared by /admin/check-registration and its API route, same as above.
 */
export function parseContactLookupInput(body: unknown): ParsedContactLookupInput {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid request' };
  const b = body as Record<string, unknown>;

  const email = asTrimmedString(b.email);
  const mobile = asTrimmedString(b.mobile);
  const contactError = validateContactDetails(email, mobile);
  if (contactError) return { ok: false, error: contactError };

  return { ok: true, input: { email: email || null, mobile: mobile || null } };
}

/** Case-, accent- and spacing-insensitive form of a name, for comparison only. */
export function normalizeNameForMatch(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

interface RegistrantNameRow {
  first_name: string | null;
  last_name: string | null;
}

// registry.registrants.email is unique, but phone is not (a household can
// share one) — a small cap is plenty to find a name match among them.
const MAX_ROWS_PER_FIELD = 10;

async function findRegistrantNames(
  client: SupabaseClient,
  column: 'email' | 'phone',
  value: string,
): Promise<RegistrantNameRow[]> {
  const { data, error } = await client
    .schema('registry')
    .from('registrants')
    .select('first_name, last_name')
    .eq(column, value)
    .limit(MAX_ROWS_PER_FIELD);
  if (error) {
    throw new Error(`Registry lookup by ${column} failed: ${error.message ?? 'unknown error'} (${error.code ?? 'no code'})`);
  }
  return (data as RegistrantNameRow[] | null) ?? [];
}

/**
 * Every registrant filed under this email and/or mobile (both exact: email
 * lower-cased, the way the pipeline stores it; mobile normalized to E.164 by
 * the same normalizePhone() the pipeline uses). Throws on a query error —
 * "not registered" must never be the answer to "the lookup broke".
 */
async function findRegistrantsByContact(
  client: SupabaseClient,
  input: ContactLookupInput,
): Promise<{ rows: RegistrantNameRow[]; matchedOn: RegistrationMatchField[] }> {
  const email = input.email ? input.email.trim().toLowerCase() : null;
  const phone = normalizePhone(input.mobile);

  const [emailRows, phoneRows] = await Promise.all([
    email ? findRegistrantNames(client, 'email', email) : Promise.resolve([]),
    phone ? findRegistrantNames(client, 'phone', phone) : Promise.resolve([]),
  ]);

  const matchedOn: RegistrationMatchField[] = [];
  if (emailRows.length > 0) matchedOn.push('email');
  if (phoneRows.length > 0) matchedOn.push('mobile');
  return { rows: [...emailRows, ...phoneRows], matchedOn };
}

/**
 * The leader version: looks the person up by contact detail, then compares
 * names (see RegistrationStatus).
 */
export async function checkRegistration(
  client: SupabaseClient,
  input: RegistrationCheckInput,
): Promise<RegistrationCheckResult> {
  const { rows, matchedOn } = await findRegistrantsByContact(client, input);
  if (matchedOn.length === 0) return { status: 'not_registered', matchedOn };

  const firstName = normalizeNameForMatch(input.firstName);
  const lastName = normalizeNameForMatch(input.lastName);
  const nameMatches = rows.some(
    (row) => normalizeNameForMatch(row.first_name) === firstName && normalizeNameForMatch(row.last_name) === lastName,
  );

  return { status: nameMatches ? 'registered' : 'name_mismatch', matchedOn };
}

/**
 * The admin version (/admin/check-registration, full admins signed in with
 * 2FA): is anyone already registered under this email or mobile? No name is
 * asked for or compared, and — like the leader version — nothing stored in
 * the registry is returned.
 */
export async function lookupRegistrationByContact(
  client: SupabaseClient,
  input: ContactLookupInput,
): Promise<ContactLookupResult> {
  const { matchedOn } = await findRegistrantsByContact(client, input);
  return { registered: matchedOn.length > 0, matchedOn };
}

/**
 * Whether this session belongs to a real state_leaders row (any role — plain
 * leader, SR or AD), resolved the same way every other "who is this" consumer
 * does: the session's user_profiles name + state matched against
 * state_leaders (see campaignFilter.ts's getUserAdminStatusAndMobile). A
 * signed-in session on its own is not enough — anonymous sign-in is open to
 * anyone holding the public anon key.
 */
export async function isSessionForStateLeader(client: SupabaseClient, userId: string): Promise<boolean> {
  const { data: profile, error: profileError } = await client
    .from('user_profiles')
    .select('name, state')
    .eq('user_id', userId)
    .maybeSingle();
  if (profileError) throw new Error(`Profile lookup failed: ${profileError.message ?? 'unknown error'}`);

  const name = (profile as { name: string | null } | null)?.name?.trim();
  const state = (profile as { state: string | null } | null)?.state?.trim();
  if (!name || !state) return false;

  const { data: leaders, error: leaderError } = await client
    .from('state_leaders')
    .select('id')
    .eq('state', state.toUpperCase())
    .ilike('leader', name.toLowerCase())
    .limit(1);
  if (leaderError) throw new Error(`Leader lookup failed: ${leaderError.message ?? 'unknown error'}`);

  return ((leaders as unknown[] | null) ?? []).length > 0;
}
