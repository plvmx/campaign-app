// Planning logic for scripts/restore_missing_registrants_from_sheet.ts —
// brings Lorraine's "Current AFJ Soulwinners as at 24 Sept 2026" sheet and
// registry.registrants back in line (2026-10-27 investigation):
//   - "restore": people on her sheet who were moved into
//     registry.twol_respondents by the 2026-09-14 List [2] migration, which
//     assumed a CSV-loaded registrant could never look "List [2] only" but
//     an ac-sync run between the reload and the migration gave them exactly
//     that. They are real registrants on her sheet, absent from registrants.
//   - "import": Australian people added to her sheet after the September
//     CSV export, so neither the reload nor ac-sync (they aren't in AC) ever
//     saw them.
//   - name corrections for a registrant whose AC contact has the placeholder
//     email noemail@noemail.com, stuck on the name pinned by their first sync.
// Pure and IO-free so every rule is unit tested; the script is the thin
// shell that reads the sheet JSON and talks to Supabase.
import { AUSTRALIAN_STATES } from '../constants';
import {
  transformRow,
  dedupeByEmail,
  type RawCsvRow,
  type TransformedRegistrant,
} from './csvRegistrantTransform';
import { normalizePhone } from './phone';

export const PLACEHOLDER_EMAIL = 'noemail@noemail.com';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_STATES: readonly string[] = AUSTRALIAN_STATES;

export interface ExistingRegistrant {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  ac_contact_id: string | null;
}

export interface TwolRespondentRef {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

export type SkipReason =
  | 'blank_or_header'
  | 'overseas'
  | 'unrecognised_state'
  | 'no_contact_details'
  | 'handled_by_name_correction'
  | 'already_in_registry'
  | 'same_name_in_registry';

export interface PlannedInsert {
  kind: 'restore' | 'import';
  registrant: TransformedRegistrant;
  /** Sheet line(s) this came from, for traceability. */
  sourceLines: number[];
  /** Why the plan treats it as notable, shown in the dry-run (e.g. blank state, phone shared with a different person). */
  notes: string[];
}

export interface SkippedRow {
  row: RawCsvRow;
  reason: SkipReason;
  detail?: string;
}

export interface NameCorrection {
  registrantId: string;
  acContactId: string | null;
  currentFirstName: string | null;
  currentLastName: string | null;
  newFirstName: string;
  newLastName: string;
  sheetLine: number;
}

export interface SheetRestorePlan {
  inserts: PlannedInsert[];
  skipped: SkippedRow[];
  nameCorrections: NameCorrection[];
}

// ---------------------------------------------------------------------
// Sheet cell cleaning
// ---------------------------------------------------------------------

/** Excel 1900-system serial -> epoch ms. Serial 25569 is 1970-01-01. */
function serialToEpochMs(serial: number): number {
  return Math.round((serial - 25569) * 86400 * 1000 / 60000) * 60000; // round to the minute
}

/**
 * The xlsx converter hands dates through as raw Excel serials ("45248.56…"),
 * but transformRow's parsers (written for the CSV) expect "D/M/YYYY" or
 * "D/M/YYYY HH:MM". Text that already isn't a plain number is returned as-is
 * so the existing parsers still reject genuine junk.
 */
export function excelSerialToAuText(raw: string, withTime: boolean): string {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return raw;
  const serial = Number(trimmed);
  if (serial < 1 || serial > 100000) return raw;
  const d = new Date(serialToEpochMs(serial));
  const date = `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
  if (!withTime) return date;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${date} ${hh}:${mm}`;
}

/**
 * Sheet emails carry stray footnote digits ("a@b.com  1") and the odd space
 * inside the address ("x@gmail. com"). Returns '' for anything that still
 * isn't an address afterwards, so it is stored as no email rather than junk.
 */
export function cleanSheetEmail(raw: string): string {
  let value = raw.trim();
  if (value.includes('@')) value = value.replace(/\s+\d+$/, '');
  if (EMAIL_PATTERN.test(value)) return value;
  const squashed = value.replace(/\s+/g, '');
  return EMAIL_PATTERN.test(squashed) ? squashed : '';
}

/** A phone is only usable if it has a plausible number of digits ("Emailed 14 Sept" is not one). */
export function cleanSheetPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 12 ? raw.trim() : '';
}

/** Last nine digits — the tolerant key used to compare "0412 345 678", "412345678" and "+61412345678". */
export function phoneKey(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-9) : '';
}

function emailKey(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

function nameKey(first: string | null | undefined, last: string | null | undefined): string {
  return `${first ?? ''} ${last ?? ''}`.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

function lastNameKey(last: string | null | undefined): string {
  return (last ?? '').toLowerCase().replace(/[^a-z]/g, '');
}

function firstNameKey(first: string | null | undefined): string {
  return (first ?? '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 3);
}

/** Converts one converted-sheet row into the shape transformRow expects. */
export function sheetRowToRaw(row: RawCsvRow): RawCsvRow {
  return {
    ...row,
    email: cleanSheetEmail(row.email),
    phone: cleanSheetPhone(row.phone),
    regd: excelSerialToAuText(row.regd, false),
    webinar: excelSerialToAuText(row.webinar, true),
    dateAgreed: excelSerialToAuText(row.dateAgreed, false),
  };
}

function isBlankOrHeader(row: RawCsvRow): boolean {
  const hasName = row.firstName.trim() !== '' || row.lastName.trim() !== '';
  if (!hasName) return true;
  // The sheet repeats its header text in a couple of rows.
  return row.email.trim() === 'Email Address' || row.state.trim() === 'Place';
}

// ---------------------------------------------------------------------
// Matching against what the registry already holds
// ---------------------------------------------------------------------

interface PersonRef {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

interface Index<T extends PersonRef> {
  byEmail: Map<string, T[]>;
  byPhone: Map<string, T[]>;
  byName: Map<string, T[]>;
}

function buildIndex<T extends PersonRef>(people: T[]): Index<T> {
  const byEmail = new Map<string, T[]>();
  const byPhone = new Map<string, T[]>();
  const byName = new Map<string, T[]>();
  const add = (map: Map<string, T[]>, key: string, p: T) => {
    if (!key) return;
    const list = map.get(key);
    if (list) list.push(p);
    else map.set(key, [p]);
  };
  for (const p of people) {
    add(byEmail, emailKey(p.email), p);
    add(byPhone, phoneKey(p.phone), p);
    add(byName, nameKey(p.first_name, p.last_name), p);
  }
  return { byEmail, byPhone, byName };
}

/**
 * Same email is always the same person. Same phone only counts when the
 * names also agree (same last name or same first-name prefix) — families
 * and couples genuinely share a mobile, and treating "Mel Campbell's phone"
 * as proof that "Shelley Campbell" is already registered would hide her.
 * Returns the match plus whether a phone-only hit was rejected on name.
 */
function findMatch<T extends PersonRef>(
  row: { first: string; last: string; email: string; phone: string },
  index: Index<T>,
): { match: T | null; sharedPhoneWith: T | null } {
  const e = emailKey(row.email);
  if (e) {
    const hit = index.byEmail.get(e)?.[0];
    if (hit) return { match: hit, sharedPhoneWith: null };
  }
  const p = phoneKey(row.phone);
  let sharedPhoneWith: T | null = null;
  if (p) {
    for (const candidate of index.byPhone.get(p) ?? []) {
      const sameLast = lastNameKey(candidate.last_name) !== '' && lastNameKey(candidate.last_name) === lastNameKey(row.last);
      const sameFirst = firstNameKey(candidate.first_name) !== '' && firstNameKey(candidate.first_name) === firstNameKey(row.first);
      if (sameLast || sameFirst) return { match: candidate, sharedPhoneWith: null };
      sharedPhoneWith = candidate;
    }
  }
  return { match: null, sharedPhoneWith };
}

// ---------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------

export function planSheetRestore(
  sheetRows: RawCsvRow[],
  registrants: ExistingRegistrant[],
  twol: TwolRespondentRef[],
): SheetRestorePlan {
  const regIndex = buildIndex(registrants);
  const twolIndex = buildIndex(twol);

  // A sheet row that corrects an existing placeholder-email registrant must
  // not also be inserted as a second, duplicate registrant.
  const nameCorrections = planNameCorrections(sheetRows, registrants);
  const correctedLines = new Set(nameCorrections.map((c) => c.sheetLine));

  const skipped: SkippedRow[] = [];
  const candidates: { kind: 'restore' | 'import'; registrant: TransformedRegistrant; notes: string[] }[] = [];

  for (const original of sheetRows) {
    if (isBlankOrHeader(original)) {
      if (original.firstName.trim() || original.lastName.trim()) skipped.push({ row: original, reason: 'blank_or_header' });
      continue;
    }
    if (correctedLines.has(original.lineNumber)) {
      skipped.push({ row: original, reason: 'handled_by_name_correction' });
      continue;
    }
    const raw = sheetRowToRaw(original);

    const transformed = transformRow(raw);
    if (transformed.status === 'excluded_non_au_state') {
      skipped.push({ row: original, reason: 'overseas', detail: transformed.state });
      continue;
    }
    const registrant = transformed.registrant;
    if (registrant.state && !VALID_STATES.includes(registrant.state)) {
      skipped.push({ row: original, reason: 'unrecognised_state', detail: registrant.state });
      continue;
    }
    if (!registrant.email && !registrant.phoneRaw) {
      skipped.push({ row: original, reason: 'no_contact_details' });
      continue;
    }

    const ref = { first: raw.firstName, last: raw.lastName, email: raw.email, phone: raw.phone };

    const inRegistry = findMatch(ref, regIndex);
    if (inRegistry.match) {
      skipped.push({ row: original, reason: 'already_in_registry' });
      continue;
    }

    const notes: string[] = [];
    if (inRegistry.sharedPhoneWith) {
      const o = inRegistry.sharedPhoneWith;
      notes.push(`phone is shared with a different registrant (${o.first_name ?? ''} ${o.last_name ?? ''}) — treated as a separate person`);
    }

    const inTwol = findMatch(ref, twolIndex);
    const kind: 'restore' | 'import' = inTwol.match ? 'restore' : 'import';

    if (kind === 'import') {
      const sameName = regIndex.byName.get(nameKey(raw.firstName, raw.lastName));
      if (sameName?.length) {
        skipped.push({ row: original, reason: 'same_name_in_registry', detail: sameName[0].email ?? sameName[0].phone ?? sameName[0].id });
        continue;
      }
    }
    if (!registrant.state) notes.push('no state on the sheet');
    candidates.push({ kind, registrant, notes });
  }

  // People sharing one email (couples) — dedupeByEmail keeps the email on
  // the largest same-name group and clears it on differently-named rows.
  const deduped = dedupeByEmail(candidates.map((c) => c.registrant));
  const byLine = new Map<number, (typeof candidates)[number]>();
  for (const c of candidates) byLine.set(c.registrant.sourceLines[0], c);

  const inserts: PlannedInsert[] = deduped.map((registrant) => {
    const origin = byLine.get(registrant.sourceLines[0])!;
    const notes = [...origin.notes];
    if (origin.registrant.email && !registrant.email) notes.push('shares an email with a differently-named row — stored without it');
    return { kind: origin.kind, registrant, sourceLines: registrant.sourceLines, notes };
  });

  return { inserts, skipped, nameCorrections };
}

/**
 * A registrant whose email is the AC placeholder (noemail@noemail.com) can't
 * be matched by email, so the name pinned on its first sync stays forever
 * (registrantNameGuard). If exactly one sheet row has the same phone and a
 * different name, propose the sheet's name. Phone-only evidence is enough
 * here because the placeholder row has no other identity at all.
 */
export function planNameCorrections(sheetRows: RawCsvRow[], registrants: ExistingRegistrant[]): NameCorrection[] {
  const corrections: NameCorrection[] = [];
  for (const reg of registrants) {
    if (emailKey(reg.email) !== PLACEHOLDER_EMAIL) continue;
    const key = phoneKey(reg.phone);
    if (!key) continue;
    const hits = sheetRows.filter((r) => !isBlankOrHeader(r) && phoneKey(cleanSheetPhone(r.phone)) === key);
    if (hits.length !== 1) continue;
    const sheet = hits[0];
    const newFirst = sheet.firstName.trim();
    const newLast = sheet.lastName.trim();
    if (nameKey(newFirst, newLast) === nameKey(reg.first_name, reg.last_name)) continue;
    corrections.push({
      registrantId: reg.id,
      acContactId: reg.ac_contact_id,
      currentFirstName: reg.first_name,
      currentLastName: reg.last_name,
      newFirstName: newFirst,
      newLastName: newLast,
      sheetLine: sheet.lineNumber,
    });
  }
  return corrections;
}

/** DB row for registry.registrants — the same mapping scripts/reload_registrants_from_csv.ts uses. */
export function toRegistrantInsertRow(r: TransformedRegistrant) {
  return {
    ac_contact_id: null,
    first_name: r.firstName,
    last_name: r.lastName,
    // Lower-cased at the write boundary — the unique index is a plain column.
    email: r.email ? r.email.toLowerCase() : null,
    phone: normalizePhone(r.phoneRaw),
    phone_raw: r.phoneRaw,
    state: r.state,
    postcode: r.postcode,
    church_name: r.churchName,
    registered_at: r.registeredAt,
    unsubscribed: r.unsubscribed,
    nfc: r.nfc,
    webinar_session_at: r.webinarSessionAt,
    webinar_attended: r.webinarAttended,
    code_of_conduct_agreed: r.codeOfConductAgreed,
    code_of_conduct_agreed_at: r.codeOfConductAgreedAt,
  };
}
