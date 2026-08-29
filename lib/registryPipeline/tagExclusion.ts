// Tag-based source EXCLUSION for the registry pipeline — distinct from
// listFilter.ts's List 3/5 exclusion, which works at the list level. This
// works at the tag level because the population being excluded here is
// mixed into List 1 itself, not confined to a separate list we can simply
// never query.
//
// Confirmed by Peter (2026-08-29), via a live ac_discovery.js tag-list
// pull: AC tag [11] "SOURCE: Mail Chimp Upload" identifies a historical
// bulk import, not an organic registration through any tracked funnel —
// it accounted for the large majority of a "why don't these registrants
// match the ground-truth spreadsheet" investigation. Lorraine, who spent
// years manually curating the registrant list from the live-updating
// spreadsheet (see Consolidate.docx), never included this population —
// her list is the operational definition of who counts as a registrant
// for AFJ's purposes, and she was careful to capture everyone who should
// be there. Decision: exclude them from the registry.
//
// This only excludes a contact when an excluded tag is their ONLY signal —
// i.e. no recognized registration-funnel tag also matched
// (sourceAttribution.ts). A contact who was originally MailChimp-imported
// but later also genuinely registered through a tracked funnel keeps that
// legitimate attribution and is NOT excluded.

import type { AcContactTag } from './types.ts';

export const EXCLUDED_SOURCE_TAG_IDS: readonly string[] = ['11'];

/**
 * True if this contact should be excluded as a registry.registrants
 * candidate — it carries an excluded-source tag and nothing else
 * recognized it as a genuine registration.
 */
export function isExcludedSourceOnly(contactTags: readonly AcContactTag[], matchedKnownSourceTag: boolean): boolean {
  if (matchedKnownSourceTag) return false;
  return contactTags.some((tag) => EXCLUDED_SOURCE_TAG_IDS.includes(tag.id));
}
