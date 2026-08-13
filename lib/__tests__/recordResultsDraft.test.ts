import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  saveDraft,
  loadDraft,
  clearDraft,
  draftHasContent,
  type RecordResultsDraft,
  type NameSlotDraft,
} from '../recordResultsDraft';

function emptySlots(): NameSlotDraft[] {
  return [];
}

function makeDraft(overrides: Partial<RecordResultsDraft> = {}): RecordResultsDraft {
  return {
    campaignId: 'c1',
    names: { TM: emptySlots(), P: emptySlots(), F: emptySlots(), SP: emptySlots(), IR: emptySlots() },
    actualLeader: '',
    teamSize: '',
    ppCnt: '',
    fpCnt: '',
    fpspCnt: '',
    irCnt: '',
    updatedAt: '2026-08-13T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('saveDraft / loadDraft', () => {
  it('round-trips a draft through localStorage, keyed by campaign id', () => {
    const draft = makeDraft({ actualLeader: 'Alice' });
    saveDraft(draft);
    expect(loadDraft('c1')).toEqual(draft);
  });

  it('keeps drafts for different campaigns independent', () => {
    saveDraft(makeDraft({ campaignId: 'c1', actualLeader: 'Alice' }));
    saveDraft(makeDraft({ campaignId: 'c2', actualLeader: 'Bob' }));
    expect(loadDraft('c1')?.actualLeader).toBe('Alice');
    expect(loadDraft('c2')?.actualLeader).toBe('Bob');
  });

  it('returns null when no draft exists for the campaign', () => {
    expect(loadDraft('missing')).toBeNull();
  });

  it('returns null (not a throw) for malformed JSON already in storage', () => {
    window.localStorage.setItem('record-results-draft:c1', '{not valid json');
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadDraft('c1')).toBeNull();
    expect(consoleWarnSpy).toHaveBeenCalled();
  });

  it('returns null when the stored draft is for a different campaign id (defensive shape check)', () => {
    window.localStorage.setItem('record-results-draft:c1', JSON.stringify(makeDraft({ campaignId: 'other' })));
    expect(loadDraft('c1')).toBeNull();
  });

  it('returns null when the stored draft has no names field', () => {
    window.localStorage.setItem('record-results-draft:c1', JSON.stringify({ campaignId: 'c1' }));
    expect(loadDraft('c1')).toBeNull();
  });

  it('does not throw when localStorage.setItem fails (e.g. quota exceeded)', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveDraft(makeDraft())).not.toThrow();
    expect(consoleWarnSpy).toHaveBeenCalled();
  });
});

describe('clearDraft', () => {
  it('removes only the given campaign\'s draft', () => {
    saveDraft(makeDraft({ campaignId: 'c1' }));
    saveDraft(makeDraft({ campaignId: 'c2' }));
    clearDraft('c1');
    expect(loadDraft('c1')).toBeNull();
    expect(loadDraft('c2')).not.toBeNull();
  });

  it('is a no-op when no draft exists', () => {
    expect(() => clearDraft('missing')).not.toThrow();
  });
});

describe('draftHasContent', () => {
  it('is false for a draft of pure empty strings', () => {
    expect(draftHasContent(makeDraft())).toBe(false);
  });

  it('is true when any name slot has a non-blank value', () => {
    const draft = makeDraft({ names: { TM: [{ value: 'Alice', dbId: null }], P: [], F: [], SP: [], IR: [] } });
    expect(draftHasContent(draft)).toBe(true);
  });

  it('is false when a name slot is whitespace-only', () => {
    const draft = makeDraft({ names: { TM: [{ value: '   ', dbId: null }], P: [], F: [], SP: [], IR: [] } });
    expect(draftHasContent(draft)).toBe(false);
  });

  it('is true when actualLeader is set', () => {
    expect(draftHasContent(makeDraft({ actualLeader: 'Alice' }))).toBe(true);
  });

  it('is true when teamSize is set', () => {
    expect(draftHasContent(makeDraft({ teamSize: '5' }))).toBe(true);
  });

  it('is true when any count field is set', () => {
    expect(draftHasContent(makeDraft({ ppCnt: '1' }))).toBe(true);
    expect(draftHasContent(makeDraft({ fpCnt: '1' }))).toBe(true);
    expect(draftHasContent(makeDraft({ fpspCnt: '1' }))).toBe(true);
    expect(draftHasContent(makeDraft({ irCnt: '1' }))).toBe(true);
  });
});
