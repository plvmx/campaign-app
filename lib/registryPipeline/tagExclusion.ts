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
//
// Extended 2026-09-14, investigating the same missing-postcode report that
// led to registry.twol_respondents (see that table's own comment): a full
// audit of every AC tag actually appearing in staging.ac_events surfaced
// two more populations with the same shape as the MailChimp case — a tag
// with no real registration-funnel signal behind it, currently flowing
// straight into registry.registrants (or, for [8]/[9] specifically,
// twol_respondents once they happen to land on List 2) with little or no
// other data:
//
//   [40]/[41] "Mobilise - Make a Donation: Form completed"/its FUNNEL
//   companion — 144 contacts whose only signal was this tag, ~2 field
//   values each. Decision (Peter, 2026-09-14): exclude, same as MailChimp
//   — a donation-form completion isn't a campaign registration, and sits
//   in the same financial-intent-adjacent sensitivity category that
//   already excludes fields [12]/[13] and List 5 elsewhere in this
//   pipeline (see List 5's own exclusion rationale in listFilter.ts's
//   header / the technical plan Section 3.6).
//
//   [8]/[9] "FORM/FUNNEL: TWOL Explore More: Requested" — 259 contacts
//   with no other signal, 257 of them with literally zero field values
//   anywhere. Most land on List 2 (already kept out of registrants by the
//   twol_respondents routing regardless of tag), but a residual 23 events
//   sit on List 1 and were still becoming ordinary, near-blank
//   registrants. Decision (Peter, 2026-09-14): exclude entirely, same as
//   MailChimp — not routed to twol_respondents either.
//
//   [6] "FORM: TWOL Video: Requested" — the tag on the very record
//   (lorraine@afj.org.au) that kicked off this whole audit. Initially
//   routed to twol_respondents alongside genuine [1]-tagged submissions,
//   since both share List [2]. Decision (Peter, 2026-09-14): exclude this
//   one entirely too, not kept in twol_respondents — a video-request
//   click isn't the same kind of event as a presenter's response report,
//   and (per the live example) carries essentially no real data anyway.
//
// Checked ahead of the List [2] → twol_respondents routing in
// transform.ts (not after, as it originally was for [11]) precisely so an
// excluded-tag-only contact is excluded regardless of which list their
// event happens to be on — being on List 2 must not accidentally exempt
// a contact from an exclusion that would otherwise apply.

import type { AcContactTag } from './types.ts';

export const EXCLUDED_SOURCE_TAG_IDS: readonly string[] = ['11', '40', '41', '8', '9', '6'];

/**
 * True if this contact should be excluded as a registry.registrants
 * candidate — it carries an excluded-source tag and nothing else
 * recognized it as a genuine registration.
 */
export function isExcludedSourceOnly(contactTags: readonly AcContactTag[], matchedKnownSourceTag: boolean): boolean {
  if (matchedKnownSourceTag) return false;
  return contactTags.some((tag) => EXCLUDED_SOURCE_TAG_IDS.includes(tag.id));
}
