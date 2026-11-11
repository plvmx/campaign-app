/**
 * Pure helpers for the "campaign reporting has moved" visit counter
 * (page: app/public/campaign-reporting-moved, store: legacy_report_visits).
 */

export interface LegacyReportVisitRow {
  visited_at: string;
  device_id: string | null;
}

export interface LegacyReportVisitSummary {
  totalVisits: number;
  /** Distinct browsers/devices (visits with no device id each count once). */
  uniqueDevices: number;
  last7Days: number;
  last30Days: number;
  lastVisitAt: string | null;
  /** Visits per Melbourne calendar day, oldest first, for the last 14 days (zero days included). */
  daily: { date: string; visits: number }[];
}

const DEVICE_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** A device id is a random token made by the page; anything else is dropped (the visit still counts). */
export function parseDeviceId(value: unknown): string | null {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value) ? value : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const melbourneDate = (ms: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);

export function summariseVisits(rows: LegacyReportVisitRow[], now: number = Date.now()): LegacyReportVisitSummary {
  const devices = new Set<string>();
  let anonymous = 0;
  let last7Days = 0;
  let last30Days = 0;
  let lastVisit = 0;
  const perDay = new Map<string, number>();

  for (const row of rows) {
    const at = new Date(row.visited_at).getTime();
    if (Number.isNaN(at)) continue;
    if (row.device_id) devices.add(row.device_id); else anonymous += 1;
    if (now - at <= 7 * DAY_MS) last7Days += 1;
    if (now - at <= 30 * DAY_MS) last30Days += 1;
    if (at > lastVisit) lastVisit = at;
    const day = melbourneDate(at);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }

  const daily: { date: string; visits: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const date = melbourneDate(now - i * DAY_MS);
    daily.push({ date, visits: perDay.get(date) ?? 0 });
  }

  return {
    totalVisits: rows.length,
    uniqueDevices: devices.size + anonymous,
    last7Days,
    last30Days,
    lastVisitAt: lastVisit ? new Date(lastVisit).toISOString() : null,
    daily,
  };
}
