// Tag-based source attribution for the registry pipeline.
// See docs/registry-pipeline/AFJ_PII_Technical_Implementation_Plan.md
// Section 3.3 — List [1] is a catch-all for 3 of the 4 live registration
// funnels, so list membership alone cannot identify which page a
// registrant came through. The AC tag is the only reliable identifier;
// match against the known tag ID list (registry.known_source_tags),
// never against a naming pattern (tag prefixes like 'ACTION:'/'CAMPAIGN:'/
// 'FORM:' are inconsistent across pages).

import type { AcContactTag, KnownSourceTag } from './types.ts';

/**
 * Finds the first of a contact's tags that matches a known source tag.
 * Returns null if none match (an unattributed submission — still recorded,
 * just without a resolvable source_tag).
 */
export function matchSourceTag(
  contactTags: readonly AcContactTag[],
  knownTags: readonly KnownSourceTag[]
): KnownSourceTag | null {
  const knownById = new Map(knownTags.map((t) => [t.ac_tag_id, t]));
  for (const tag of contactTags) {
    const match = knownById.get(tag.id);
    if (match) return match;
  }
  return null;
}
