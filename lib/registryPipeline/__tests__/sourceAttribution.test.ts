import { describe, expect, it } from 'vitest';
import { matchSourceTag } from '../sourceAttribution';
import type { KnownSourceTag } from '../types';

const KNOWN_TAGS: KnownSourceTag[] = [
  { ac_tag_id: '21', tag_name: 'ACTION: Australia For Jesus Commitment', source_label: 'register_page' },
  { ac_tag_id: '48', tag_name: 'CAMPAIGN: TWOL Sept 2019 Register', source_label: 'wayoflife_interest' },
  { ac_tag_id: '58', tag_name: 'CAMPAIGN: Bringing Others Webinar: Registered', source_label: 'botj_webinar' },
  { ac_tag_id: '1', tag_name: 'FORM: Way of life responder: Completed', source_label: 'wayoflife_responder' },
];

describe('matchSourceTag', () => {
  it('matches a known tag by ID, not by name pattern', () => {
    const result = matchSourceTag([{ id: '48' }], KNOWN_TAGS);
    expect(result?.source_label).toBe('wayoflife_interest');
  });

  it('returns the first known tag found when a contact has multiple tags', () => {
    const result = matchSourceTag([{ id: '999' }, { id: '58' }], KNOWN_TAGS);
    expect(result?.source_label).toBe('botj_webinar');
  });

  it('returns null when no tag matches', () => {
    const result = matchSourceTag([{ id: '999' }], KNOWN_TAGS);
    expect(result).toBeNull();
  });

  it('returns null for a contact with no tags at all', () => {
    expect(matchSourceTag([], KNOWN_TAGS)).toBeNull();
  });

  it('does not match on tag_name text, only ac_tag_id', () => {
    // A tag whose id happens not to be in the known list should never match
    // even if some other field were to coincidentally resemble a known name.
    const result = matchSourceTag([{ id: 'ACTION: Australia For Jesus Commitment' }], KNOWN_TAGS);
    expect(result).toBeNull();
  });
});
