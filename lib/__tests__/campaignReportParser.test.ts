import { describe, it, expect } from 'vitest';
import {
  parseTallyValue,
  parseCampaignDate,
  normalizeCampaignReportRow,
} from '../campaignReportParser';

describe('parseTallyValue', () => {
  it('passes a clean number straight through', () => {
    expect(parseTallyValue(6)).toEqual({ value: 6, raw: null });
    expect(parseTallyValue(0)).toEqual({ value: 0, raw: null });
  });

  it('treats null/undefined/empty as no data', () => {
    expect(parseTallyValue(null)).toEqual({ value: null, raw: null });
    expect(parseTallyValue(undefined)).toEqual({ value: null, raw: null });
    expect(parseTallyValue('  ')).toEqual({ value: null, raw: null });
  });

  it('maps known zero-words to 0, keeping the original text', () => {
    expect(parseTallyValue('Nil')).toEqual({ value: 0, raw: 'Nil' });
    expect(parseTallyValue('None')).toEqual({ value: 0, raw: 'None' });
    expect(parseTallyValue('—')).toEqual({ value: 0, raw: '—' });
    expect(parseTallyValue('O')).toEqual({ value: 0, raw: 'O' }); // letter-O typo for zero, seen in the real sheet
  });

  it('extracts a leading number from a note, keeping the full text', () => {
    expect(parseTallyValue('10(1 with 5 persons, 1 with 3 and 1 with 2)')).toEqual({
      value: 10,
      raw: '10(1 with 5 persons, 1 with 3 and 1 with 2)',
    });
    expect(parseTallyValue('3 (incl 1 affirmation) ')).toEqual({ value: 3, raw: '3 (incl 1 affirmation)' });
  });

  it('yields null value for pure narrative with no leading digit, but preserves it', () => {
    const note = 'Gave out 3 new testaments, 4 books of eternity.';
    expect(parseTallyValue(note)).toEqual({ value: null, raw: note });
  });
});

const submittedAt = (iso: string) => new Date(iso);

describe('parseCampaignDate', () => {
  it('accepts a clean native Date', () => {
    expect(parseCampaignDate(new Date(2021, 8, 2), submittedAt('2021-09-02T18:17:36Z'))).toEqual({
      date: '2021-09-02',
      raw: null,
      needsReview: false,
    });
  });

  it('parses dot-separated D.M.Y', () => {
    expect(parseCampaignDate('25.9.21', submittedAt('2021-09-25T12:00:00Z'))).toEqual({
      date: '2021-09-25',
      raw: '25.9.21',
      needsReview: false,
    });
  });

  it('parses dot-separated Y.M.D', () => {
    expect(parseCampaignDate('2024.04.06', submittedAt('2024-04-06T12:00:00Z'))).toEqual({
      date: '2024-04-06',
      raw: '2024.04.06',
      needsReview: false,
    });
  });

  it('parses "D Month YYYY"', () => {
    expect(parseCampaignDate('18th September 2021', submittedAt('2021-09-18T12:00:00Z'))).toEqual({
      date: '2021-09-18',
      raw: '18th September 2021',
      needsReview: false,
    });
  });

  it('parses "Month D" with the year inferred from the submission date', () => {
    expect(parseCampaignDate('August 7th', submittedAt('2026-08-08T12:00:00Z'))).toEqual({
      date: '2026-08-07',
      raw: 'August 7th',
      needsReview: false,
    });
  });

  it('strips a day-of-week prefix', () => {
    expect(parseCampaignDate('Saturday 23rd October 2021', submittedAt('2021-10-25T12:00:00Z'))).toEqual({
      date: '2021-10-23',
      raw: 'Saturday 23rd October 2021',
      needsReview: false,
    });
  });

  it('takes the first date out of a multi-date entry, preserving the full original text', () => {
    expect(parseCampaignDate('9/9/21 & 10/9/21', submittedAt('2021-09-10T12:00:00Z'))).toEqual({
      date: '2021-09-09',
      raw: '9/9/21 & 10/9/21',
      needsReview: false,
    });
  });

  it('rolls a yearless month back a year across a Dec/Jan reporting gap', () => {
    // Campaign run in December, report filed the following January.
    expect(parseCampaignDate('28th December', submittedAt('2022-01-03T12:00:00Z'))).toEqual({
      date: '2021-12-28',
      raw: '28th December',
      needsReview: false,
    });
  });

  it('parses an unambiguous 8-digit YYYYMMDD typed as a plain number', () => {
    expect(parseCampaignDate(20240914, submittedAt('2024-09-14T18:39:23Z'))).toEqual({
      date: '2024-09-14',
      raw: '20240914',
      needsReview: false,
    });
  });

  it('flags a short, ambiguous digit string instead of guessing', () => {
    // Real example: "50222" is ambiguous (could be several things); the sheet's
    // own submission date makes "5/2/22" plausible but that's a guess, not a fact.
    const result = parseCampaignDate(50222, submittedAt('2022-02-05T16:45:15Z'));
    expect(result.date).toBeNull();
    expect(result.needsReview).toBe(true);
    expect(result.raw).toBe('50222');
  });

  it('flags a corrupted Excel serial (year wildly out of range)', () => {
    const wild = new Date(6702324, 0, 1); // outside MIN_YEAR..MAX_YEAR
    const result = parseCampaignDate(wild, submittedAt('2024-01-01T12:00:00Z'));
    expect(result.date).toBeNull();
    expect(result.needsReview).toBe(true);
  });

  it('flags unrecognizable free text instead of guessing', () => {
    const result = parseCampaignDate('Harvey', submittedAt('2023-06-01T12:00:00Z'));
    expect(result.date).toBeNull();
    expect(result.needsReview).toBe(true);
    expect(result.raw).toBe('Harvey');
  });

  it('treats a missing cell as no data, not a review flag', () => {
    expect(parseCampaignDate(null, submittedAt('2023-06-01T12:00:00Z'))).toEqual({
      date: null,
      raw: null,
      needsReview: false,
    });
  });

  // Real production bug (found 2026-09-01, after the initial 6,203-row load):
  // a plausible-looking parse with an explicit — but wrong — year sailed
  // through untouched because the only submission-date sanity check applied
  // to the *year-missing* code path, not to dates that already carried an
  // explicit (if mistyped) year. Reproduced here from the exact rows Peter
  // flagged in production. See BRIEF.md for the full investigation.
  describe('implausible dates relative to the submission timestamp (regression)', () => {
    it('rejects a native Excel date a leader fat-fingered a year into the future', () => {
      // Real row: submitted 2026-08-07, campaign_date came out 2027-08-08.
      const result = parseCampaignDate(new Date(2027, 7, 8), submittedAt('2026-08-07T21:12:59Z'));
      expect(result.date).toBeNull();
      expect(result.needsReview).toBe(true);
      expect(result.raw).toBe('2027-08-08'); // no original text for a native Date cell — falls back to the parsed ISO value
    });

    it('rejects a dot-format date with a typo\'d year a decade off', () => {
      // Real row: "14.6.35" submitted 2025-06-13 — the leader meant "14.6.25".
      const result = parseCampaignDate('14.6.35', submittedAt('2025-06-13T22:21:39Z'));
      expect(result.date).toBeNull();
      expect(result.needsReview).toBe(true);
      expect(result.raw).toBe('14.6.35');
    });

    it('rejects a "D Month YYYY" date exactly a year ahead of submission', () => {
      // Real row: "27th Feb 2028" submitted 2025-02-26.
      const result = parseCampaignDate('27th Feb 2028', submittedAt('2025-02-26T20:13:02Z'));
      expect(result.date).toBeNull();
      expect(result.needsReview).toBe(true);
      expect(result.raw).toBe('27th Feb 2028');
    });

    it('rejects a native Excel date several years in the past', () => {
      // Real row: submitted 2026-06-27, campaign_date came out 2020-06-26.
      const result = parseCampaignDate(new Date(2020, 5, 26), submittedAt('2026-06-27T01:43:20Z'));
      expect(result.date).toBeNull();
      expect(result.needsReview).toBe(true);
    });

    it('still accepts a genuinely late backlog report (~1 year late, correct date)', () => {
      // Real pattern seen in production: several leaders (e.g. "Sunshine")
      // batch-submitted a full year of backlogged reports at once — the
      // campaign_date is correct, just very late. Must not be flagged.
      const result = parseCampaignDate('10th May 2024', submittedAt('2025-05-09T20:13:15Z'));
      expect(result).toEqual({ date: '2024-05-10', raw: '10th May 2024', needsReview: false });
    });

    it('rejects a past date multiple years further back than any genuine backlog pattern', () => {
      const result = parseCampaignDate(new Date(2020, 5, 23), submittedAt('2026-05-23T04:54:16Z'));
      expect(result.date).toBeNull();
      expect(result.needsReview).toBe(true);
    });
  });
});

describe('normalizeCampaignReportRow', () => {
  it('normalizes a clean row end to end', () => {
    const result = normalizeCampaignReportRow({
      submittedAt: new Date('2021-09-02T18:17:36Z'),
      location: 'Glenelg SA',
      leader: 'Anne Mills',
      campaignDate: new Date(2021, 8, 2),
      partialPresentations: 1,
      fullPresentations: 6,
      sinnersPrayer: 0,
      informationRequests: 0,
    });
    expect(result).toEqual({
      submitted_at: new Date('2021-09-02T18:17:36Z').toISOString(),
      campaign_date: '2021-09-02',
      campaign_date_raw: null,
      location_raw: 'Glenelg SA',
      leader_raw: 'Anne Mills',
      partial_presentations: 1,
      partial_presentations_raw: null,
      full_presentations: 6,
      full_presentations_raw: null,
      sinners_prayer: 0,
      sinners_prayer_raw: null,
      information_requests: 0,
      information_requests_raw: null,
      needs_review: false,
      source: 'jordan_sheet_import',
    });
  });

  it('sets needs_review when the campaign date is unparseable', () => {
    const result = normalizeCampaignReportRow({
      submittedAt: new Date('2023-06-01T12:00:00Z'),
      location: 'Harvey',
      leader: 'Someone',
      campaignDate: 'Harvey', // real example: a location, not a date, ended up in this cell
      partialPresentations: 1,
      fullPresentations: 0,
      sinnersPrayer: 0,
      informationRequests: 0,
    });
    expect(result?.needs_review).toBe(true);
    expect(result?.campaign_date).toBeNull();
  });

  it('sets needs_review when a tally column is an unparseable narrative', () => {
    const result = normalizeCampaignReportRow({
      submittedAt: new Date('2021-09-04T16:17:03Z'),
      location: 'Gladstone',
      leader: 'Warwick Taylor',
      campaignDate: new Date(2021, 8, 4),
      partialPresentations: 1,
      fullPresentations: 3,
      sinnersPrayer: 0,
      informationRequests: 'Gave out 3 new testaments, 4 books of eternity.',
    });
    expect(result?.needs_review).toBe(true);
    expect(result?.information_requests).toBeNull();
    expect(result?.information_requests_raw).toBe('Gave out 3 new testaments, 4 books of eternity.');
  });

  it('returns null when submittedAt is missing or invalid — the row cannot be de-duped without it', () => {
    expect(
      normalizeCampaignReportRow({
        submittedAt: null,
        location: 'Somewhere',
        leader: 'Someone',
        campaignDate: null,
        partialPresentations: 1,
        fullPresentations: 0,
        sinnersPrayer: 0,
        informationRequests: 0,
      })
    ).toBeNull();
  });
});
