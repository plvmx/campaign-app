/**
 * Local-only backup of a campaign report being typed on /record-results/report.
 *
 * The page keeps what the leader types in memory only, and nothing reaches the
 * server until Save & Submit. A phone browser (iPhone Safari especially) often
 * discards a background page and reloads it when the leader comes back — e.g.
 * after switching to Google Docs to look up names (reported 2026-11-22) — which
 * left them an empty form. So every change is mirrored to localStorage (it
 * survives the page being discarded), keyed by campaign, and restored on load.
 * Cleared after a successful save and after a week. Holds only what was typed:
 * team size, the four counts and the names. Nothing is sent anywhere.
 */
import {
  REPORT_COUNT_FIELDS,
  nameFieldCount,
  resizeNames,
  sanitizeCountInput,
  sanitizeNameInput,
  sanitizeTeamSizeInput,
  type ReportCountField,
} from './campaignReportEntry';

export interface ReportDraft {
  teamSize: string;
  counts: Record<ReportCountField, string>;
  names: Record<ReportCountField, string[]>;
}

export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const keyFor = (campaignId: string) => `afj_campaign_report_draft:${campaignId}`;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // blocked (e.g. private browsing)
  }
}

/** True if the leader has typed anything at all (an all-blank draft isn't worth keeping). */
export function draftHasContent(draft: ReportDraft): boolean {
  return (
    draft.teamSize !== '' ||
    REPORT_COUNT_FIELDS.some(({ key }) => draft.counts[key] !== '' || draft.names[key].some((n) => n.trim() !== ''))
  );
}

export function clearReportDraft(campaignId: string): void {
  try {
    storage()?.removeItem(keyFor(campaignId));
  } catch { /* ignore */ }
}

/** Remembers the draft, or forgets it if it is empty. Never throws. */
export function saveReportDraft(campaignId: string, draft: ReportDraft, now: number = Date.now()): void {
  if (!draftHasContent(draft)) { clearReportDraft(campaignId); return; }
  try {
    storage()?.setItem(keyFor(campaignId), JSON.stringify({ ...draft, savedAt: now }));
  } catch { /* quota or blocked storage: the form still works, just without a backup */ }
}

/**
 * The remembered draft, cleaned up with the same typing rules as the form, or
 * null if there is none, it is older than a week, or it is malformed (expired
 * and malformed ones are also removed).
 */
export function readReportDraft(campaignId: string, now: number = Date.now()): ReportDraft | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(keyFor(campaignId));
    if (!raw) return null;
    const data = JSON.parse(raw) as Record<string, unknown>;
    const counts = data.counts as Record<string, unknown> | undefined;
    const names = data.names as Record<string, unknown> | undefined;
    if (
      typeof data.savedAt !== 'number' || now - data.savedAt > DRAFT_MAX_AGE_MS || data.savedAt > now + 60_000 ||
      typeof data.teamSize !== 'string' || !counts || !names
    ) {
      clearReportDraft(campaignId);
      return null;
    }
    const cleanCounts = {} as Record<ReportCountField, string>;
    const cleanNames = {} as Record<ReportCountField, string[]>;
    for (const { key } of REPORT_COUNT_FIELDS) {
      const c = counts[key];
      const n = names[key];
      if (typeof c !== 'string' || !Array.isArray(n) || n.some((x) => typeof x !== 'string')) {
        clearReportDraft(campaignId);
        return null;
      }
      cleanCounts[key] = sanitizeCountInput(c);
      // One name box per counted person, exactly as the form shows them.
      cleanNames[key] = resizeNames((n as string[]).map(sanitizeNameInput), nameFieldCount(cleanCounts[key]));
    }
    const draft = { teamSize: sanitizeTeamSizeInput(data.teamSize), counts: cleanCounts, names: cleanNames };
    return draftHasContent(draft) ? draft : null;
  } catch {
    clearReportDraft(campaignId);
    return null;
  }
}
