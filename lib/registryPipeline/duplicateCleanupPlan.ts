// Planning logic for scripts/cleanup_registrant_duplicates.ts (2026-11-17,
// Lorraine reported duplicates in the Registry).
//
// Where they came from: the September CSV reload copied the source
// spreadsheet's email column verbatim, including a trailing footnote digit
// ("kifinti52@hotmail.com    1" — the spreadsheet's way of marking a second
// person on a shared address) and stray spaces ("shippys @iinet.net.au").
// registry.registrants is deduped on the exact email string, so those rows
// look like different people to the database — and to ac-sync, which would
// never match a later registration to them.
//
// What this plans (pure and IO-free, so every rule is unit tested; the
// script is the thin shell that reads/writes Supabase):
//   - MERGE: two rows that are certainly the same person —
//       * same cleaned email AND same name (Jill Shipway twice), or
//       * an email-less row with the same phone AND name as exactly one
//         email-bearing row (or as another email-less row).
//     The survivor keeps its own values and only has blanks filled in.
//   - EMAIL FIX: a dirty email that, once cleaned, collides with nobody.
//     A trailing footnote digit / case / outer whitespace is "safe"; spaces
//     *inside* the address ("laurie. msc@gmail.com") are a guess and are
//     marked "review" (the script only applies them on request).
//   - SHARED EMAIL: same cleaned email, different names — a couple on one
//     address. They are different people, so nothing is merged and the
//     second partner's row keeps its dirty email (the unique index allows
//     the address on one row only).
//   - REVIEW PAIRS: same name + same phone, different emails — probably the
//     same person with two addresses, but only a human can tell. Reported
//     for Lorraine; never changed automatically.
import { normalizePhone } from './phone';

export interface DedupRegistrant {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  phone_raw: string | null;
  ac_contact_id: string | null;
  registered_at: string | null;
  state: string | null;
  postcode: string | null;
  church_name: string | null;
  church_leader: string | null;
  interested_in_training: string | null;
  webinar_session_at: string | null;
  webinar_attended: string | null;
  code_of_conduct_agreed: string | null;
  code_of_conduct_agreed_at: string | null;
  unsubscribed: string | null;
  nfc: string | null;
}

/** Columns a survivor may have filled in from a merged-away row (only when its own value is blank). */
export const MERGE_FILL_FIELDS = [
  'phone', 'phone_raw', 'ac_contact_id', 'state', 'postcode', 'church_name', 'church_leader',
  'interested_in_training', 'webinar_session_at', 'webinar_attended', 'code_of_conduct_agreed',
  'code_of_conduct_agreed_at', 'first_name', 'last_name',
] as const;

/** Flags where "Yes" on either row must win — never lose an unsubscribe / No Further Contact. */
const FLAG_FIELDS = ['unsubscribed', 'nfc'] as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailCleanKind = 'unchanged' | 'tidied' | 'footnote_removed' | 'inner_space_removed' | 'invalid';

export interface CleanedEmail {
  email: string | null;
  kind: EmailCleanKind;
}

/**
 * Cleans an email read from the registry. `footnote_removed` (a trailing
 * 1–2 digit marker after whitespace) and `tidied` (case/outer whitespace)
 * are safe; `inner_space_removed` is a guess at what was meant.
 */
export function cleanRegistrantEmail(raw: string | null): CleanedEmail {
  if (raw === null || raw.trim() === '') return { email: null, kind: 'unchanged' };
  let value = raw.trim().toLowerCase();
  let kind: EmailCleanKind = value === raw ? 'unchanged' : 'tidied';
  const withoutFootnote = value.replace(/\s+\d{1,2}$/, '');
  if (withoutFootnote !== value && withoutFootnote.includes('@')) {
    value = withoutFootnote.trim();
    kind = 'footnote_removed';
  }
  if (/\s/.test(value)) {
    value = value.replace(/\s+/g, '');
    kind = 'inner_space_removed';
  }
  if (!EMAIL_PATTERN.test(value)) return { email: null, kind: 'invalid' };
  return { email: value, kind };
}

/** Lower-cased, whitespace-collapsed "first last"; null unless both parts are present. */
export function nameKey(r: Pick<DedupRegistrant, 'first_name' | 'last_name'>): string | null {
  const first = r.first_name?.trim();
  const last = r.last_name?.trim();
  if (!first || !last) return null;
  return `${first} ${last}`.toLowerCase().replace(/\s+/g, ' ');
}

const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === '';

export type MergeReason = 'same_email_and_name' | 'same_phone_and_name_no_email' | 'review_keep_newest';

export interface MergePlan {
  reason: MergeReason;
  survivorId: string;
  loserIds: string[];
  /** Columns to set on the survivor (blank-fills, earliest registered_at, flags). Excludes email. */
  updates: Record<string, string>;
  /** Set on the survivor AFTER the losers are deleted (unique index on email). */
  emailChange: { from: string | null; to: string } | null;
  /** Both rows had a different non-blank value — the survivor's was kept. */
  conflicts: string[];
}

export interface EmailFix {
  registrantId: string;
  from: string;
  to: string;
  kind: Exclude<EmailCleanKind, 'unchanged' | 'invalid'>;
  /** 'safe' = footnote/case/outer whitespace; 'review' = spaces inside the address were removed. */
  risk: 'safe' | 'review';
}

export interface SharedEmailRow {
  registrantId: string;
  name: string;
  rawEmail: string;
  cleanedEmail: string;
}

export interface ReviewPair {
  name: string;
  phone: string;
  rows: { id: string; email: string | null; registeredAt: string | null; state: string | null }[];
}

export interface DuplicateCleanupPlan {
  merges: MergePlan[];
  emailFixes: EmailFix[];
  /** Dirty email left as is: another person already holds the cleaned address. */
  sharedEmailLeftAlone: SharedEmailRow[];
  /** Dirty email we could not turn into a valid address. */
  unfixable: { registrantId: string; rawEmail: string }[];
  reviewPairs: ReviewPair[];
}

function byRegisteredThenId(a: DedupRegistrant, b: DedupRegistrant): number {
  const ad = a.registered_at ?? '9999';
  const bd = b.registered_at ?? '9999';
  return ad < bd ? -1 : ad > bd ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Survivor: has an AC contact id, then an already-clean email, then registered earliest. */
function pickSurvivor(rows: DedupRegistrant[]): DedupRegistrant {
  const score = (r: DedupRegistrant) =>
    (r.ac_contact_id ? 2 : 0) + (r.email !== null && cleanRegistrantEmail(r.email).kind === 'unchanged' ? 1 : 0);
  return [...rows].sort((a, b) => score(b) - score(a) || byRegisteredThenId(a, b))[0];
}

function buildMerge(
  reason: MergeReason,
  rows: DedupRegistrant[],
  allRows: DedupRegistrant[],
  forcedSurvivor?: DedupRegistrant,
): MergePlan {
  const survivor = forcedSurvivor ?? pickSurvivor(rows);
  const losers = rows.filter((r) => r.id !== survivor.id).sort(byRegisteredThenId);
  const updates: Record<string, string> = {};
  const conflicts: string[] = [];

  for (const field of MERGE_FILL_FIELDS) {
    if (!blank(survivor[field])) {
      const same = (a: string | null, b: string | null) => (field === 'first_name' || field === 'last_name' ? a?.toLowerCase() === b?.toLowerCase() : a === b);
      const other = losers.find((l) => !blank(l[field]) && !same(l[field], survivor[field]));
      if (other && field !== 'phone_raw') conflicts.push(`${field}: kept "${survivor[field]}", other row had "${other[field]}"`);
      continue;
    }
    const donor = losers.find((l) => !blank(l[field]));
    if (donor) updates[field] = donor[field] as string;
  }
  for (const field of FLAG_FIELDS) {
    if (survivor[field] !== 'Yes' && losers.some((l) => l[field] === 'Yes')) updates[field] = 'Yes';
  }
  const dates = rows.map((r) => r.registered_at).filter((d): d is string => !!d).sort();
  if (dates.length && dates[0] !== survivor.registered_at) updates.registered_at = dates[0];

  const cleaned = survivor.email === null ? null : cleanRegistrantEmail(survivor.email).email;
  // Another person (not part of this merge) may already hold the cleaned
  // address — the unique index would reject the update after the losers are
  // gone, so leave the survivor's email as it is in that case.
  const mergeIds = new Set(rows.map((r) => r.id));
  const heldByOther = cleaned !== null && allRows.some((o) => !mergeIds.has(o.id) && o.email === cleaned);
  const emailChange = cleaned && cleaned !== survivor.email && !heldByOther ? { from: survivor.email, to: cleaned } : null;
  return { reason, survivorId: survivor.id, loserIds: losers.map((l) => l.id), updates, emailChange, conflicts };
}

function groupBy<T>(items: T[], key: (item: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return map;
}

export function planDuplicateCleanup(rows: DedupRegistrant[]): DuplicateCleanupPlan {
  const cleaned = new Map(rows.map((r) => [r.id, cleanRegistrantEmail(r.email)]));
  const cleanEmailOf = (r: DedupRegistrant) => cleaned.get(r.id)?.email ?? null;

  const merges: MergePlan[] = [];
  const mergedAway = new Set<string>(); // losers
  const inMerge = new Set<string>(); // losers + survivors

  // 1. Same cleaned email + same name.
  const byEmail = groupBy(rows, cleanEmailOf);
  for (const group of byEmail.values()) {
    if (group.length < 2) continue;
    for (const sameName of groupBy(group, nameKey).values()) {
      if (sameName.length < 2) continue;
      const merge = buildMerge('same_email_and_name', sameName, rows);
      merges.push(merge);
      sameName.forEach((r) => inMerge.add(r.id));
      merge.loserIds.forEach((id) => mergedAway.add(id));
    }
  }

  // 2. Email-less rows: same phone + same name as exactly one email-bearing
  //    row, or as other email-less rows. Keys are phone-normalised.
  const phoneNameKey = (r: DedupRegistrant) => {
    const phone = normalizePhone(r.phone ?? r.phone_raw);
    const name = nameKey(r);
    return phone && name ? `${phone}|${name}` : null;
  };
  const emailBearing = rows.filter((r) => cleanEmailOf(r) !== null && !mergedAway.has(r.id));
  const withEmailByKey = groupBy(emailBearing, phoneNameKey);
  const noEmail = rows.filter((r) => r.email === null || r.email.trim() === '');
  for (const [key, group] of groupBy(noEmail, phoneNameKey)) {
    const owners = withEmailByKey.get(key) ?? [];
    if (owners.length > 1) continue; // ambiguous — left for review
    const members = owners.length === 1 ? [owners[0], ...group] : group;
    if (members.length < 2 || members.some((m) => inMerge.has(m.id))) continue;
    // The email-bearing row must survive — email is not a fill-in field.
    const merge = buildMerge('same_phone_and_name_no_email', members, rows, owners[0]);
    merges.push(merge);
    members.forEach((r) => inMerge.add(r.id));
    merge.loserIds.forEach((id) => mergedAway.add(id));
  }

  // 3. Email fixes / shared addresses / unfixable.
  const emailFixes: EmailFix[] = [];
  const sharedEmailLeftAlone: SharedEmailRow[] = [];
  const unfixable: DuplicateCleanupPlan['unfixable'] = [];
  const survivorWithEmailChange = new Set(merges.filter((m) => m.emailChange).map((m) => m.survivorId));
  for (const r of rows) {
    if (r.email === null || mergedAway.has(r.id) || survivorWithEmailChange.has(r.id)) continue;
    const c = cleaned.get(r.id)!;
    if (c.kind === 'unchanged') continue;
    if (c.kind === 'invalid' || c.email === null) {
      unfixable.push({ registrantId: r.id, rawEmail: r.email });
      continue;
    }
    const holders = (byEmail.get(c.email) ?? []).filter((o) => o.id !== r.id && !mergedAway.has(o.id));
    if (holders.length > 0) {
      sharedEmailLeftAlone.push({ registrantId: r.id, name: nameKey(r) ?? '(no name)', rawEmail: r.email, cleanedEmail: c.email });
      continue;
    }
    emailFixes.push({
      registrantId: r.id,
      from: r.email,
      to: c.email,
      kind: c.kind,
      risk: c.kind === 'inner_space_removed' ? 'review' : 'safe',
    });
  }

  // 4. Same name + same phone, different emails, not already merged.
  const reviewPairs: ReviewPair[] = [];
  const remaining = rows.filter((r) => !mergedAway.has(r.id) && !inMerge.has(r.id));
  const reviewKey = (r: DedupRegistrant) => phoneNameKey(r);
  for (const [key, group] of groupBy(remaining, reviewKey)) {
    if (group.length < 2) continue;
    const [phone, name] = key.split('|');
    reviewPairs.push({
      name,
      phone,
      rows: group.map((r) => ({ id: r.id, email: r.email, registeredAt: r.registered_at, state: r.state })),
    });
  }
  reviewPairs.sort((a, b) => a.name.localeCompare(b.name));

  return { merges, emailFixes, sharedEmailLeftAlone, unfixable, reviewPairs };
}

/** Newest registration wins; on a tie, the row with an AC contact id, then the lowest id. */
function pickNewestSurvivor(rows: DedupRegistrant[]): DedupRegistrant {
  return [...rows].sort((a, b) => {
    const ad = a.registered_at ?? '';
    const bd = b.registered_at ?? '';
    if (ad !== bd) return ad < bd ? 1 : -1;
    const acDiff = (b.ac_contact_id ? 1 : 0) - (a.ac_contact_id ? 1 : 0);
    if (acDiff !== 0) return acDiff;
    return a.id < b.id ? -1 : 1;
  })[0];
}

/**
 * Turns the "same name + same phone, different emails" review groups into
 * merges, once a human (Lorraine, 2026-11-17) has said they are the same
 * person and the older registration(s) should go. The newest registration's
 * row survives (its email is the one kept); blanks are filled from the older
 * rows and an unsubscribe / No-Further-Contact flag is never lost.
 */
export function planKeepNewestMerges(pairs: ReviewPair[], allRows: DedupRegistrant[]): MergePlan[] {
  const byId = new Map(allRows.map((r) => [r.id, r]));
  return pairs.map((pair) => {
    const rows = pair.rows.map((r) => byId.get(r.id)).filter((r): r is DedupRegistrant => !!r);
    return buildMerge('review_keep_newest', rows, allRows, pickNewestSurvivor(rows));
  });
}
