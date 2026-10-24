/**
 * Campaign Report project — see docs/campaign-report/BRIEF.md.
 *
 * Reads the live Google Sheet (link-shared, "anyone with the link can view")
 * into the same raw-row shape `normalizeCampaignReportRow` already consumes.
 * No API key and no xlsx-parsing library (see scripts/campaign_reports_xlsx_to_json.py
 * for why those are avoided): two plain public endpoints are merged instead.
 *
 *  - `/export?format=csv` carries every cell's text, including the free-text
 *    notes leaders typed into date and tally columns.
 *  - `/gviz/tq?tqx=out:json` carries real types (true dates/numbers), but
 *    returns null for any cell whose type differs from its column's majority
 *    — so on its own it silently loses ~2,400 text cells.
 *
 * CSV supplies the text; gviz supplies the typed dates (which CSV can only
 * show as ambiguous display strings like "4/9/21"). Rows are aligned by
 * position, and every row's timestamp is cross-checked between the two
 * responses so a row added between the two requests fails loudly instead of
 * shifting data.
 *
 * Temporary by design: removed when the app's own campaign-report numbers
 * replace this sheet.
 */
import { parseCsv, stripBom } from '@/lib/registryPipeline/csvParse';
import type { RawCampaignReportSheetRow } from '@/lib/campaignReportParser';

/** The sheet's timestamps are wall-clock times in this zone (matches the 2021-2026 historical load). */
export const SHEET_TIME_ZONE = 'Australia/Melbourne';

const CSV_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const GVIZ_DATE = /^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?(?:,\d+)?\)$/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/** Offset (ms, east of UTC) of `zone` at the instant `utcMs`. */
function zoneOffsetMs(utcMs: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Converts a wall-clock time in `zone` to the real instant, whatever zone the server itself runs in. */
export function wallClockToDate(
  y: number, mo: number, d: number, h: number, mi: number, s: number,
  zone: string = SHEET_TIME_ZONE,
): Date {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  let result = naive - zoneOffsetMs(naive, zone);
  // Re-check at the candidate instant so a time just either side of a DST change resolves correctly.
  result = naive - zoneOffsetMs(result, zone);
  return new Date(result);
}

export interface GvizCell { v?: unknown; f?: string }
export type GvizRow = { c: (GvizCell | null)[] };

/** Strips Google's JSONP wrapper from a gviz response and returns its rows. */
export function parseGvizRows(body: string): GvizRow[] {
  const start = body.indexOf('(');
  const end = body.lastIndexOf(')');
  if (start < 0 || end < start) throw new Error('Unexpected Google Sheets response (not a gviz payload)');
  const json = JSON.parse(body.slice(start + 1, end));
  if (json.status !== 'ok') throw new Error(`Google Sheets returned status "${json.status}"`);
  return json.table.rows as GvizRow[];
}

function gvizValue(cell: GvizCell | null | undefined): unknown {
  return cell && cell.v !== undefined ? cell.v : null;
}

/** A gviz `Date(y,m,d[,h,mi,s])` string as its components (month is 1-based here), or null. */
function parseGvizDate(v: unknown): number[] | null {
  if (typeof v !== 'string') return null;
  const m = v.match(GVIZ_DATE);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]) + 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
}

function csvText(cells: string[], index: number): string | null {
  const t = cells[index];
  return t === undefined || t.trim() === '' ? null : t;
}

/** A tally: gviz's exact number when it has one, otherwise the CSV text (a number written out, or a typed note). */
function tally(gviz: GvizCell | null | undefined, csv: string | null): unknown {
  const v = gvizValue(gviz);
  if (typeof v === 'number') return v;
  if (csv !== null && PLAIN_NUMBER.test(csv.trim())) return Number(csv.trim());
  return csv;
}

/**
 * Merges the CSV and gviz exports into raw sheet rows (header row excluded,
 * fully blank rows dropped). Throws if the two responses don't line up row
 * for row — a sheet edited mid-fetch — so the caller can simply retry.
 */
export function mergeSheetExports(csvBody: string, gvizBody: string): RawCampaignReportSheetRow[] {
  const csvRows = parseCsv(stripBom(csvBody)).slice(1);
  const gvizRows = parseGvizRows(gvizBody);
  if (csvRows.length !== gvizRows.length) {
    throw new Error(`Sheet changed while reading (${csvRows.length} CSV rows vs ${gvizRows.length} typed rows) — retry`);
  }

  const out: RawCampaignReportSheetRow[] = [];
  gvizRows.forEach((g, i) => {
    const cells = csvRows[i];
    if (cells.every((c) => c.trim() === '')) return;

    // Column A: the submission timestamp, the row's de-dup key.
    const csvStamp = csvText(cells, 0);
    const gvizStamp = g.c[0]?.f ?? null;
    if (csvStamp !== null && gvizStamp !== null && csvStamp.trim() !== gvizStamp) {
      throw new Error(`Sheet changed while reading (row ${i + 2} timestamp mismatch) — retry`);
    }
    const stamp = parseGvizDate(gvizValue(g.c[0])) ?? csvStamp?.trim().match(CSV_TIMESTAMP)?.slice(1).map(Number) ?? null;
    const submittedAt = stamp ? wallClockToDate(stamp[0], stamp[1], stamp[2], stamp[3], stamp[4], stamp[5]) : null;

    // Column D: the campaign date — a true date when the cell is one, else whatever was typed.
    const dateParts = parseGvizDate(gvizValue(g.c[3]));
    // Built from local parts on purpose: the parser reads getFullYear()/getMonth()/getDate().
    // A digit-only entry (e.g. 20240203) was a plain number in the sheet, which the parser treats differently from text.
    const dateText = csvText(cells, 3);
    const campaignDate = dateParts
      ? new Date(dateParts[0], dateParts[1] - 1, dateParts[2])
      : dateText !== null && /^\d+$/.test(dateText.trim()) ? Number(dateText.trim()) : dateText;

    out.push({
      submittedAt,
      location: csvText(cells, 1),
      leader: csvText(cells, 2),
      campaignDate,
      partialPresentations: tally(g.c[4], csvText(cells, 4)),
      fullPresentations: tally(g.c[5], csvText(cells, 5)),
      sinnersPrayer: tally(g.c[6], csvText(cells, 6)),
      informationRequests: tally(g.c[7], csvText(cells, 7)),
    });
  });
  return out;
}

/** Downloads both exports of a link-shared sheet and merges them. */
export async function fetchCampaignReportSheetRows(
  sheetId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RawCampaignReportSheetRow[]> {
  const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}`;
  const [csvRes, gvizRes] = await Promise.all([
    fetchImpl(`${base}/export?format=csv`, { cache: 'no-store' }),
    fetchImpl(`${base}/gviz/tq?tqx=out:json`, { cache: 'no-store' }),
  ]);
  if (!csvRes.ok || !gvizRes.ok) {
    throw new Error(`Google Sheet fetch failed (CSV ${csvRes.status}, typed ${gvizRes.status}) — is it still shared with "anyone with the link"?`);
  }
  return mergeSheetExports(await csvRes.text(), await gvizRes.text());
}
