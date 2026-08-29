import { describe, expect, it } from 'vitest';
import { isExcludedSourceOnly } from '../tagExclusion';

describe('isExcludedSourceOnly', () => {
  it('excludes a contact whose only tag is the MailChimp-import tag [11]', () => {
    expect(isExcludedSourceOnly([{ id: '11' }], false)).toBe(true);
  });

  it('excludes a contact with the excluded tag plus unrelated other tags, as long as none are a known source tag', () => {
    expect(isExcludedSourceOnly([{ id: '11' }, { id: '12' }], false)).toBe(true);
  });

  it('does not exclude a contact who also has a recognized registration-funnel tag match', () => {
    // matchedKnownSourceTag=true means sourceAttribution.ts already found a
    // legitimate tag — the excluded tag being additionally present doesn't override that.
    expect(isExcludedSourceOnly([{ id: '11' }, { id: '21' }], true)).toBe(false);
  });

  it('does not exclude a contact with no excluded tag at all', () => {
    expect(isExcludedSourceOnly([{ id: '48' }], false)).toBe(false);
  });

  it('does not exclude a contact with no tags at all', () => {
    expect(isExcludedSourceOnly([], false)).toBe(false);
  });
});
