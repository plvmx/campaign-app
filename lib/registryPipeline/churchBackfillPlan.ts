// Planning logic for scripts/backfill_church_from_staging.ts — the registrants
// whose church_name is blank only because ac-sync never read AC field [8]
// (every registrant synced since the "AFJ Register Commitment" form started
// writing the church there), recovered from the raw payloads already saved in
// staging.ac_events. Pure and IO-free so the rules are unit tested.
import { mapAcFields } from './fieldMap';
import type { RawAcContactPayload } from './types';

// "No church" answers typed into the Church box. Storing them would put "None"
// in the Church column, which reads as bad data, so the backfill skips them.
const PLACEHOLDER_CHURCHES = new Set([
  'none', 'na', 'nil', 'no', 'nothing', 'notapplicable', 'nochurch', 'nonenil', 'unknown', 'tbc', 'x',
]);

/** True for an answer that says "no church" rather than naming one ("None", "N/A", "Nil.", "-", "No church"…). */
export function isPlaceholderChurch(value: string): boolean {
  const key = value.toLowerCase().replace(/[^a-z]/g, '');
  return key === '' || PLACEHOLDER_CHURCHES.has(key);
}

export interface BlankChurchRegistrant {
  id: string;
  acContactId: string;
  email: string | null;
}

export interface ChurchBackfillUpdate {
  registrantId: string;
  acContactId: string;
  email: string | null;
  churchName: string;
}

/**
 * For each registrant with a blank church, the church found in that AC
 * contact's most recent staging payload (the caller passes the latest event
 * per contact). A registrant with no payload, or whose latest payload still
 * has no church (or only a placeholder such as "None"), is left out — this
 * only ever fills, never clears.
 */
export function planChurchBackfill(
  registrants: BlankChurchRegistrant[],
  latestPayloadByContact: Map<string, RawAcContactPayload>,
): ChurchBackfillUpdate[] {
  const updates: ChurchBackfillUpdate[] = [];
  for (const r of registrants) {
    const payload = latestPayloadByContact.get(r.acContactId);
    if (!payload) continue;
    const churchName = mapAcFields(payload).churchName;
    if (!churchName || isPlaceholderChurch(churchName)) continue;
    updates.push({ registrantId: r.id, acContactId: r.acContactId, email: r.email, churchName });
  }
  return updates;
}
