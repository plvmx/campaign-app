import { describe, it, expect } from 'vitest';
import { mergeSheetExports, wallClockToDate, parseGvizRows, fetchCampaignReportSheetRows } from '../campaignReportSheetReader';

const HEADER = 'Date,Location,Campaign Leader,Dates,Partial Presentations,Full Presentations,Sinners Prayer ,Information Requests';

function gviz(rows: unknown[]): string {
  return `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table: { rows } })});`;
}
const cell = (v: unknown, f?: string) => ({ v, f });

describe('wallClockToDate', () => {
  it('reads sheet times as Melbourne wall-clock regardless of the server zone (AEST, +10)', () => {
    expect(wallClockToDate(2021, 9, 2, 18, 17, 36).toISOString()).toBe('2021-09-02T08:17:36.000Z');
  });
  it('uses daylight saving when it applies (AEDT, +11)', () => {
    expect(wallClockToDate(2026, 1, 15, 12, 0, 0).toISOString()).toBe('2026-01-15T01:00:00.000Z');
  });
});

describe('parseGvizRows', () => {
  it('strips the JSONP wrapper', () => {
    expect(parseGvizRows(gviz([{ c: [] }]))).toEqual([{ c: [] }]);
  });
  it('throws on a non-ok status', () => {
    expect(() => parseGvizRows('x({"status":"error"});')).toThrow(/status/);
  });
});

describe('mergeSheetExports', () => {
  const stamp = cell('Date(2021,8,2,18,17,36)', '2021-09-02 18:17:36');

  it('takes typed dates from gviz and typed notes the typed feed lost from the CSV', () => {
    const csv = `${HEADER}\n2021-09-02 18:17:36,Glenelg SA,Anne Mills,2/9/21,1,6,Nil,"Gave out 3 testaments"\n`;
    const g = gviz([{ c: [stamp, cell('Glenelg SA'), cell('Anne Mills'), cell('Date(2021,8,2)', '2/9/21'), cell(1), cell(6), null, null] }]);
    const [row] = mergeSheetExports(csv, g);
    expect(row.submittedAt).toEqual(new Date('2021-09-02T08:17:36.000Z'));
    expect(row.campaignDate).toEqual(new Date(2021, 8, 2));
    expect(row.partialPresentations).toBe(1);
    expect(row.sinnersPrayer).toBe('Nil');
    expect(row.informationRequests).toBe('Gave out 3 testaments');
  });

  it('keeps a typed-as-text campaign date as text, and a digit-only one as a number', () => {
    const csv = `${HEADER}\n2021-09-02 18:17:36,A,B,18th September 2021,1,1,1,1\n2021-09-02 18:20:00,A,B,20240203,1,1,1,1\n`;
    const g = gviz([
      { c: [stamp, cell('A'), cell('B'), null, cell(1), cell(1), cell(1), cell(1)] },
      { c: [cell('Date(2021,8,2,18,20,0)', '2021-09-02 18:20:00'), cell('A'), cell('B'), null, cell(1), cell(1), cell(1), cell(1)] },
    ]);
    const rows = mergeSheetExports(csv, g);
    expect(rows[0].campaignDate).toBe('18th September 2021');
    expect(rows[1].campaignDate).toBe(20240203);
  });

  it('drops fully blank rows', () => {
    const csv = `${HEADER}\n,,,,,,,\n`;
    expect(mergeSheetExports(csv, gviz([{ c: [null, null, null, null, null, null, null, null] }]))).toEqual([]);
  });

  it('throws if the two exports disagree on row count or timestamps (sheet edited mid-fetch)', () => {
    const csv = `${HEADER}\n2021-09-02 18:17:36,A,B,,1,1,1,1\n`;
    expect(() => mergeSheetExports(csv, gviz([]))).toThrow(/retry/);
    const other = gviz([{ c: [cell('Date(2021,8,3,1,1,1)', '2021-09-03 01:01:01')] }]);
    expect(() => mergeSheetExports(csv, other)).toThrow(/mismatch/);
  });
});

describe('fetchCampaignReportSheetRows', () => {
  it('explains a non-shared sheet', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 403 })) as unknown as typeof fetch;
    await expect(fetchCampaignReportSheetRows('abc', fetchImpl)).rejects.toThrow(/anyone with the link/);
  });
});
