import { describe, it, expect, beforeEach } from 'vitest';
import {
  DRAFT_MAX_AGE_MS, clearReportDraft, draftHasContent, readReportDraft, saveReportDraft, type ReportDraft,
} from '../campaignReportDraft';

const blank: ReportDraft = {
  teamSize: '',
  counts: { partial: '', full: '', sinnersPrayers: '', followUp: '' },
  names: { partial: [], full: [], sinnersPrayers: [], followUp: [] },
};
const typed: ReportDraft = {
  teamSize: '3',
  counts: { partial: '1', full: '2', sinnersPrayers: '', followUp: '0' },
  names: { partial: ['Ann'], full: ['Bob', ''], sinnersPrayers: [], followUp: [] },
};
const KEY = 'afj_campaign_report_draft:c1';
const NOW = 1_800_000_000_000;

beforeEach(() => localStorage.clear());

describe('report draft', () => {
  it('comes back exactly as typed', () => {
    saveReportDraft('c1', typed, NOW);
    expect(readReportDraft('c1', NOW + 1000)).toEqual(typed);
  });

  it('is kept separately for each campaign', () => {
    saveReportDraft('c1', typed, NOW);
    expect(readReportDraft('c2', NOW)).toBeNull();
  });

  it('is forgotten when saving an empty form, and by clearReportDraft', () => {
    saveReportDraft('c1', typed, NOW);
    saveReportDraft('c1', blank, NOW);
    expect(localStorage.getItem(KEY)).toBeNull();
    saveReportDraft('c1', typed, NOW);
    clearReportDraft('c1');
    expect(readReportDraft('c1', NOW)).toBeNull();
  });

  it('expires after a week and is removed', () => {
    saveReportDraft('c1', typed, NOW);
    expect(readReportDraft('c1', NOW + DRAFT_MAX_AGE_MS - 1)).not.toBeNull();
    expect(readReportDraft('c1', NOW + DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it.each([
    ['not JSON', '{nope'],
    ['no savedAt', JSON.stringify({ teamSize: '2', counts: typed.counts, names: typed.names })],
    ['a count that is not text', JSON.stringify({ savedAt: NOW, teamSize: '2', counts: { ...typed.counts, full: 5 }, names: typed.names })],
    ['a names list of the wrong type', JSON.stringify({ savedAt: NOW, teamSize: '2', counts: typed.counts, names: { ...typed.names, full: 'Bob' } })],
  ])('treats %s as no draft and removes it', (_label, raw) => {
    localStorage.setItem(KEY, raw);
    expect(readReportDraft('c1', NOW)).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('cleans what it reads with the form\'s own typing rules and keeps one name box per counted person', () => {
    localStorage.setItem(KEY, JSON.stringify({
      savedAt: NOW,
      teamSize: '123',
      counts: { partial: '2x', full: '0', sinnersPrayers: '', followUp: '' },
      names: { partial: ['Ann9'], full: ['Left over'], sinnersPrayers: [], followUp: [] },
    }));
    expect(readReportDraft('c1', NOW)).toEqual({
      teamSize: '12',
      counts: { partial: '2', full: '0', sinnersPrayers: '', followUp: '' },
      names: { partial: ['Ann', ''], full: [], sinnersPrayers: [], followUp: [] },
    });
  });

  it('never throws when storage is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
    try {
      expect(() => saveReportDraft('c1', typed, NOW)).not.toThrow();
      expect(readReportDraft('c1', NOW)).toBeNull();
      expect(() => clearReportDraft('c1')).not.toThrow();
    } finally {
      Object.defineProperty(window, 'localStorage', original);
    }
  });

  it('draftHasContent ignores blanks but counts a typed name', () => {
    expect(draftHasContent(blank)).toBe(false);
    expect(draftHasContent({ ...blank, names: { ...blank.names, full: ['  '] } })).toBe(false);
    expect(draftHasContent({ ...blank, names: { ...blank.names, full: ['Bob'] } })).toBe(true);
  });
});
