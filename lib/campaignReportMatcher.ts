/**
 * Derives state/place/leader for `campaign_reports` rows submitted since the
 * Campaign Report project's resumed cutoff (2026-05-06, per Peter) by
 * matching the sheet's free-text `location_raw`/`leader_raw` against this
 * app's own `state_places`/`state_leaders` reference tables.
 *
 * Full sheet history (2020-2026) was ruled out for this kind of matching in
 * phase 1 — see docs/campaign-report/BRIEF.md — because the text is too
 * inconsistent (1,355 distinct locations, 1,693 distinct leaders). The more
 * recent slice is meaningfully cleaner (mostly bare suburb/venue names and
 * first names, occasionally with a team-size suffix), so a normalization +
 * small verified-alias pass recovers state for the large majority of rows.
 *
 * Philosophy, matching lib/campaignReportParser.ts: never guess. A row that
 * can't be confidently resolved gets `null` fields, not a best-effort pick —
 * see scripts/derive_campaign_reports_fields.ts for how those are surfaced.
 */

export interface PlaceRef {
  state: string;
  place: string;
}

export interface LeaderRef {
  state: string;
  leader: string;
}

/** A confirmed mapping from a normalized sheet location (see locationKey) to a state and, when known, a state_places place. */
export interface LocationAliasRef {
  location_key: string;
  state: string;
  place: string | null;
}

export interface DerivedFields {
  state: string | null;
  place: string | null;
  leader: string | null;
}

// Verified against the live state_places table (each key confirmed to
// resolve to a real row) — typos and abbreviation mismatches between how
// leaders typed the sheet's "Location" column and how the place is actually
// stored in state_places. Keys are already lowercased/trimmed.
const LOCATION_ALIASES: Record<string, string> = {
  'mount gambier': 'mt gambier',
  'my gambier': 'mt gambier', // typo
  'charters towers': 'charters twrs',
  'paramatta': 'parramatta', // typo
  'crinulla': 'cronulla', // typo
  'cronulla beach': 'cronulla',
  'narree warren': 'narre warren', // typo
  'strathfueld': 'strathfield', // typo
  'rouse hill town centre': 'rouse hill',
  'dandening': 'dandenong', // typo
};

const FULL_STATE_NAMES: Record<string, string> = {
  'new south wales': 'NSW',
  'victoria': 'VIC',
  'queensland': 'QLD',
  'south australia': 'SA',
  'western australia': 'WA',
  'tasmania': 'TAS',
  'northern territory': 'NT',
  'australian capital territory': 'ACT',
};
const STATE_ABBR = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

/**
 * Normalizes a sheet "Location" entry for matching: strips bracketed asides,
 * trailing state names/abbreviations (bare or parenthetical), stray periods
 * between letters ("Mt.Gambier" -> "Mt Gambier"), trailing punctuation, and a
 * short list of qualifier words that don't change which place is meant.
 */
export function normalizeLocationForMatch(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = raw.trim();
  s = s.replace(/\s*\[[^\]]*\]\s*$/i, ''); // trailing "[main street]"
  s = s.replace(/\.(?=[A-Za-z])/g, ' '); // "Mt.Gambier" -> "Mt Gambier"
  s = s.replace(/([A-Za-z])(\d)/g, '$1 $2'); // "CBD1" -> "CBD 1"

  // Trailing parenthetical or bare state name/abbreviation, e.g. "(Vic)", "- Vic", "Victoria".
  const fullNamesPattern = Object.keys(FULL_STATE_NAMES).join('|');
  const stateTail = new RegExp(
    `[\\s,.\\-]*\\(?\\b(${STATE_ABBR.join('|')}|${fullNamesPattern})\\b\\)?\\.?\\s*$`,
    'i',
  );
  s = s.replace(stateTail, '');

  s = s.replace(/[.,-]\s*$/, '');
  s = s.replace(/\s+(update|shops?|shopping centre|main street|station)$/i, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** The key a location is stored/looked up under in campaign_report_location_aliases. */
export function locationKey(raw: string | null | undefined): string {
  return normalizeLocationForMatch(raw).toLowerCase();
}

const STATE_HINT = new RegExp(
  `(?:^|[\\s,.(\\-])(${STATE_ABBR.join('|')}|${Object.keys(FULL_STATE_NAMES).join('|')})\\)?\\.?\\s*$`,
  'i',
);

/**
 * The state a leader explicitly typed at the end of a location ("Brighton SA",
 * "Ayr Nth Qld", "Queanbeyan, NSW"), or null. This is the strongest signal we
 * have — stronger than a place-name match (the same name exists in several
 * states) and than the leader's usual state (leaders travel).
 */
export function extractStateHint(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(STATE_HINT);
  if (!m) return null;
  const token = m[1].toLowerCase();
  return FULL_STATE_NAMES[token] ?? m[1].toUpperCase();
}

/**
 * Normalizes a sheet "Campaign Leader" entry for matching: strips trailing
 * team-size annotations ("+2", "(+ 3)", ", 5") and a trailing co-leader
 * mention ("& Lanre", "and Josh"), leaving just the primary leader's name.
 */
export function normalizeLeaderForMatch(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = raw.trim();
  s = s.replace(/\(?\s*[+&,]\s*\d+\s*\)?\s*$/i, ''); // trailing "+2" / "(+3)" / ", 5"
  s = s.replace(/\s*(&|and)\s+\S.*$/i, ''); // trailing "& Lanre" / "and Josh"
  return s.trim();
}

/**
 * Matches a normalized location against state_places, trying (in order):
 * an exact match (after alias substitution), a forward prefix match (the
 * location is the base of a site-numbered place, e.g. "Orange" -> "Orange
 * 1"/"Orange 2"), and a reverse prefix match (the location carries an extra
 * trailing descriptor beyond a real place, e.g. "Perth CBD1" -> "Perth CBD").
 * Returns every candidate row so the caller can resolve state/place together
 * with the leader match — never picks a "best guess" itself.
 */
export function matchPlace(locationRaw: string | null | undefined, places: PlaceRef[]): PlaceRef[] {
  const normalized = normalizeLocationForMatch(locationRaw);
  if (!normalized) return [];
  const key = (LOCATION_ALIASES[normalized.toLowerCase()] ?? normalized).toLowerCase();

  const exact = places.filter((p) => p.place.trim().toLowerCase() === key);
  if (exact.length) return exact;

  const forwardPrefix = places.filter((p) => p.place.trim().toLowerCase().startsWith(`${key} `));
  if (forwardPrefix.length) return forwardPrefix;

  const reversePrefix = places.filter((p) => key.startsWith(`${p.place.trim().toLowerCase()} `));
  if (reversePrefix.length) return reversePrefix;

  return [];
}

/**
 * Matches a normalized leader name against state_leaders: an exact match
 * first, falling back to a first-name-only match (handles the sheet using a
 * fuller/shorter form than how the leader is stored, e.g. "Linda H" vs
 * "Linda", "Maria McCully" vs "Maria").
 */
export function matchLeader(leaderRaw: string | null | undefined, leaders: LeaderRef[]): LeaderRef[] {
  const normalized = normalizeLeaderForMatch(leaderRaw);
  if (!normalized) return [];
  const key = normalized.toLowerCase();

  const exact = leaders.filter((l) => l.leader.trim().toLowerCase() === key);
  if (exact.length) return exact;

  const firstToken = key.split(/\s+/)[0];
  const firstTokenMatches = leaders.filter(
    (l) => l.leader.trim().toLowerCase().split(/\s+/)[0] === firstToken,
  );
  if (firstTokenMatches.length) return firstTokenMatches;

  return [];
}

/**
 * Combines a place match and a leader match into a single derived
 * state/place/leader, requiring the two to agree when both resolve to a
 * state. Each of the three output fields is independently nulled out if it
 * can't be pinned to exactly one value — a resolvable state with an
 * ambiguous place (e.g. "Orange" matching both "Orange 1" and "Orange 2")
 * still yields a confident state with place left null.
 */
export function deriveCampaignReportFields(
  row: { location_raw: string | null; leader_raw: string | null },
  places: PlaceRef[],
  leaders: LeaderRef[],
  aliases: ReadonlyMap<string, LocationAliasRef> = new Map(),
): DerivedFields {
  const leaderCandidates = matchLeader(row.leader_raw, leaders);
  const pickLeader = (state: string): string | null => {
    const inState = leaderCandidates.filter((l) => l.state === state);
    return inState.length === 1 ? inState[0].leader : null;
  };

  // A confirmed alias (an admin's decision) beats every heuristic below.
  const alias = aliases.get(locationKey(row.location_raw));
  if (alias) return { state: alias.state, place: alias.place, leader: pickLeader(alias.state) };

  const hint = extractStateHint(row.location_raw);
  const allPlaceCandidates = matchPlace(row.location_raw, places);
  // An explicit state discards place matches in other states ("Brighton SA" is not NSW's "Brighton Le S").
  const placeCandidates = hint ? allPlaceCandidates.filter((p) => p.state === hint) : allPlaceCandidates;

  const placeStates = [...new Set(placeCandidates.map((p) => p.state))];
  const leaderStates = [...new Set(leaderCandidates.map((l) => l.state))];

  // A typed state is trusted outright. Otherwise a unique place match is
  // trusted (it's the stronger signal — a leader mismatch just means that name
  // wasn't resolvable, not that the place is wrong). No place match at all
  // falls back to a unique leader match. An *ambiguous* place (matches >1
  // state) is only resolved if the leader's state(s) narrow it down to exactly
  // one — a leader match to a state the place doesn't even support is a real
  // disagreement, not a tiebreak, so that yields no resolution.
  let state: string | null = null;
  if (hint) {
    state = hint;
  } else if (placeStates.length === 1) {
    state = placeStates[0];
  } else if (placeStates.length === 0) {
    if (leaderStates.length === 1) state = leaderStates[0];
  } else if (leaderStates.length >= 1) {
    const common = placeStates.filter((s) => leaderStates.includes(s));
    if (common.length === 1) state = common[0];
  }

  if (!state) return { state: null, place: null, leader: null };

  const placeInState = placeCandidates.filter((p) => p.state === state);
  return {
    state,
    place: placeInState.length === 1 ? placeInState[0].place : null,
    leader: pickLeader(state),
  };
}
