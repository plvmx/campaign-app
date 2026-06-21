/**
 * Local-only backup of in-progress Record Results edits.
 *
 * The page's autosave can lose work in several real-world ways: network
 * drops mid-save, browser tab closes before the 2-second debounce fires,
 * iOS Safari pagehide/visibilitychange quirks, transient RLS rejections.
 * This module mirrors the form state to localStorage on every change and
 * exposes it for restore on page load, so even if every server-side save
 * path fails, the user's typing is still on their device.
 *
 * The draft is keyed by campaign id, cleared only after a confirmed
 * successful name save, and intentionally narrow (just the fields the
 * Record Results page owns).
 */

export type ResultsCategory = 'TM' | 'P' | 'F' | 'SP' | 'IR';

/**
 * One name slot as it appears in the visible form. `dbId` is the
 * primary key of the corresponding row in the `results` table once it
 * has been saved at least once; null means this slot has never reached
 * the server. Empty `value` with a non-null `dbId` represents "user
 * cleared a previously-saved entry — delete it on next save".
 */
export interface NameSlotDraft {
  value: string;
  dbId: string | null;
}

export interface RecordResultsDraft {
  campaignId: string;
  names: Record<ResultsCategory, NameSlotDraft[]>;
  actualLeader: string;
  teamSize: string;
  ppCnt: string;
  fpCnt: string;
  fpspCnt: string;
  irCnt: string;
  updatedAt: string; // ISO timestamp
}

const STORAGE_PREFIX = 'record-results-draft:';
const keyFor = (campaignId: string) => `${STORAGE_PREFIX}${campaignId}`;

function safeStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveDraft(draft: RecordResultsDraft): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(keyFor(draft.campaignId), JSON.stringify(draft));
  } catch (err) {
    // QuotaExceeded or a privacy-mode restriction — non-fatal.
    console.warn('Failed to write Record Results draft:', err);
  }
}

export function loadDraft(campaignId: string): RecordResultsDraft | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(keyFor(campaignId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RecordResultsDraft;
    // Basic shape check — anything malformed is treated as no draft.
    if (!parsed || parsed.campaignId !== campaignId || !parsed.names) return null;
    return parsed;
  } catch (err) {
    console.warn('Failed to read Record Results draft:', err);
    return null;
  }
}

export function clearDraft(campaignId: string): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(keyFor(campaignId));
  } catch {
    // Non-fatal.
  }
}

/**
 * True if the draft has any meaningful content (a name, count, or actual
 * leader entry). Used so a draft of pure empty strings doesn't trigger a
 * "restored unsaved names" banner.
 */
export function draftHasContent(draft: RecordResultsDraft): boolean {
  const anyName = (Object.values(draft.names) as NameSlotDraft[][])
    .some((arr) => arr.some((s) => s.value.trim().length > 0));
  if (anyName) return true;
  if (draft.actualLeader.trim()) return true;
  if (draft.teamSize.trim()) return true;
  if (draft.ppCnt.trim() || draft.fpCnt.trim() || draft.fpspCnt.trim() || draft.irCnt.trim()) return true;
  return false;
}
