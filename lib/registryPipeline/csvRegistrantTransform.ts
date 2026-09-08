// Transform rules for the registrations CSV reload. See
// docs/registry-pipeline/OPERATIONS.md's two 2026-09-07 entries for the
// full decision history — this module is the implementation of those
// decisions, kept framework/IO-free so every rule is independently
// testable (scripts/reload_registrants_from_csv.ts is the thin script
// that reads the actual file and calls into this).

export interface RawCsvRow {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  state: string;
  postcode: string;
  church: string;
  regd: string; // D/M/YYYY text, as found in the source
  lineNumber: number; // 1-indexed CSV line, for traceability in logs/errors
}

export interface TransformedRegistrant {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phoneRaw: string | null;
  state: string | null;
  postcode: string | null;
  churchName: string | null;
  registeredAt: string | null; // ISO date (midnight UTC — the source has no time component)
  unsubscribed: 'Yes' | null;
  nfc: 'Yes' | null;
  sourceLines: number[]; // CSV line(s) this row was built from — 1 normally, >1 after a dedup merge
}

/** Rows with these states are excluded from the reload entirely (decision 3) — not loaded with a null/placeholder state, skipped. */
export const EXCLUDED_NON_AU_STATES = ['OS', 'NZ', 'UK'];

/**
 * Case-insensitive "does this value contain the marker, and what's left
 * after removing it" — shared by both the NFC-in-postcode check (decision
 * 7) and the UNSUBSCRIBED-in-Church check (decision 4). Removes the
 * marker as actually cased in the source, wherever it's found, and
 * collapses the whitespace left behind.
 */
export function extractMarker(raw: string, marker: string): { found: boolean; cleaned: string } {
  const re = new RegExp(marker, 'i');
  const match = raw.match(re);
  if (!match) return { found: false, cleaned: raw.trim() };
  const cleaned = (raw.slice(0, match.index) + raw.slice((match.index ?? 0) + match[0].length))
    .replace(/\s+/g, ' ')
    .trim();
  return { found: true, cleaned };
}

const VALID_AU_POSTCODE = /^\d{4}$/;

/** Decision 7 then decision 2, in that order: NFC marker is checked before the postcode is validated/nulled. */
export function extractPostcode(raw: string): { postcode: string | null; nfc: 'Yes' | null } {
  const { found, cleaned } = extractMarker(raw, 'NFC');
  const postcode = VALID_AU_POSTCODE.test(cleaned) ? cleaned : null;
  return { postcode, nfc: found ? 'Yes' : null };
}

/** Decision 4: UNSUBSCRIBED marker in the Church field. */
export function extractChurch(raw: string): { churchName: string | null; unsubscribed: 'Yes' | null } {
  const { found, cleaned } = extractMarker(raw, 'UNSUBSCRIBED');
  return { churchName: cleaned || null, unsubscribed: found ? 'Yes' : null };
}

/** "D/M/YYYY" (as found in the CSV's Regd column) -> ISO date at midnight UTC. Null if unparseable. */
export function parseAuDate(raw: string): string | null {
  const match = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, d, m, y] = match;
  const day = Number(d);
  const month = Number(m);
  const year = Number(y);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // Validate it round-trips (catches e.g. 31/02/2020) rather than trusting the regex alone.
  const d2 = new Date(`${iso}T00:00:00Z`);
  if (d2.getUTCFullYear() !== year || d2.getUTCMonth() + 1 !== month || d2.getUTCDate() !== day) return null;
  return `${iso}T00:00:00Z`;
}

export type RowTransformResult =
  | { status: 'included'; registrant: TransformedRegistrant }
  | { status: 'excluded_non_au_state'; state: string };

/** Per-row transform — everything decidable without looking at any other row. Cross-row de-duplication (dedupeByEmail) runs after this. */
export function transformRow(raw: RawCsvRow): RowTransformResult {
  const state = raw.state.trim().toUpperCase() || null;
  if (state && EXCLUDED_NON_AU_STATES.includes(state)) {
    return { status: 'excluded_non_au_state', state };
  }

  const { postcode, nfc } = extractPostcode(raw.postcode);
  const { churchName, unsubscribed } = extractChurch(raw.church);

  return {
    status: 'included',
    registrant: {
      firstName: raw.firstName.trim() || null,
      lastName: raw.lastName.trim() || null,
      email: raw.email.trim() || null,
      phoneRaw: raw.phone.trim() || null,
      state,
      postcode,
      churchName,
      registeredAt: parseAuDate(raw.regd),
      unsubscribed,
      nfc,
      sourceLines: [raw.lineNumber],
    },
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const existing = map.get(key);
    if (existing) {
      existing.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}

function normalizeName(r: TransformedRegistrant): string {
  return `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Non-null values win; when both sides have a (different) non-null value, the chronologically later row wins — see OPERATIONS.md decision 6's Pattern C. */
function mergeField<K extends keyof TransformedRegistrant>(
  rows: TransformedRegistrant[],
  key: K,
): TransformedRegistrant[K] {
  const sorted = [...rows].sort((a, b) => (a.registeredAt ?? '').localeCompare(b.registeredAt ?? ''));
  let result: TransformedRegistrant[K] | null = null;
  for (const r of sorted) {
    const v = r[key];
    if (v !== null && v !== undefined && v !== '') result = v;
  }
  return (result ?? sorted[sorted.length - 1][key]) as TransformedRegistrant[K];
}

function mergeSameEmailCluster(rows: TransformedRegistrant[]): TransformedRegistrant {
  if (rows.length === 1) return rows[0];
  return {
    firstName: mergeField(rows, 'firstName'),
    lastName: mergeField(rows, 'lastName'),
    email: rows[0].email,
    phoneRaw: mergeField(rows, 'phoneRaw'),
    state: mergeField(rows, 'state'),
    postcode: mergeField(rows, 'postcode'),
    churchName: mergeField(rows, 'churchName'),
    registeredAt: mergeField(rows, 'registeredAt'),
    unsubscribed: rows.some((r) => r.unsubscribed === 'Yes') ? 'Yes' : null,
    nfc: rows.some((r) => r.nfc === 'Yes') ? 'Yes' : null,
    sourceLines: rows.flatMap((r) => r.sourceLines),
  };
}

/**
 * De-duplicates by normalized email (OPERATIONS.md decision "identity
 * redesigned" + decision 6). Within a group sharing one email, rows are
 * further split by normalized name: this is what generalizes the
 * steve.i.walker@icloud.com / "Cilla Geldenhuys" anomaly into an
 * algorithmic rule rather than a hardcoded special case — a differently-
 * named row sharing someone else's email is treated as a *different*
 * person who doesn't legitimately own that email (resolved as option
 * (b): she keeps her own row, with the email removed, matchable only by
 * phone going forward). The name sub-group with the most rows keeps the
 * email; every other sub-group's rows have their email cleared. Ties
 * broken by whichever sub-group's earliest row is chronologically first.
 */
export function dedupeByEmail(registrants: TransformedRegistrant[]): TransformedRegistrant[] {
  const noEmail = registrants.filter((r) => !r.email);
  const withEmail = registrants.filter((r): r is TransformedRegistrant & { email: string } => !!r.email);
  const byEmail = groupBy(withEmail, (r) => normalizeEmail(r.email));

  const result: TransformedRegistrant[] = [...noEmail];

  for (const group of byEmail.values()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    const byName = groupBy(group, normalizeName);

    if (byName.size === 1) {
      result.push(mergeSameEmailCluster(group));
      continue;
    }

    // Genuinely different names sharing one email — pick the owner
    // sub-group (most rows, then earliest first row) and strip the email
    // from everyone else.
    const subgroups = [...byName.values()].sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      const aFirst = [...a].sort((x, y) => (x.registeredAt ?? '').localeCompare(y.registeredAt ?? ''))[0];
      const bFirst = [...b].sort((x, y) => (x.registeredAt ?? '').localeCompare(y.registeredAt ?? ''))[0];
      return (aFirst.registeredAt ?? '').localeCompare(bFirst.registeredAt ?? '');
    });

    const [owner, ...others] = subgroups;
    result.push(mergeSameEmailCluster(owner));
    for (const other of others) {
      for (const r of other) {
        result.push({ ...r, email: null });
      }
    }
  }

  return result;
}
