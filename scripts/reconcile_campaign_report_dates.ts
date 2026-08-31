/**
 * Campaign Report project — see docs/campaign-report/BRIEF.md.
 *
 * One-off reconciliation for a bug found 2026-09-01, after the initial
 * 6,203-row load: `parseCampaignDate()` only sanity-checked a parsed date
 * against the submission timestamp when the year had to be *inferred*
 * (a year-less date like "27th Feb"). A date with an explicit — but
 * mistyped — year (e.g. "14.6.35" meaning 2025, or a native Excel date a
 * leader fat-fingered a year into) sailed through untouched, producing
 * campaign_date values years off in either direction. See the fix in
 * lib/campaignReportParser.ts (`isPlausibleRelativeToSubmission`) and its
 * regression tests in lib/__tests__/campaignReportParser.test.ts.
 *
 * Because the fix only *adds* a rejection gate to an already-successful
 * parse — it never changes how an accepted date's value is computed — the
 * only possible effect per row is a flip from (some date, needs_review:
 * false) to (null, needs_review: true). This script re-normalizes every
 * sheet row with the fixed parser, compares campaign_date/campaign_date_raw/
 * needs_review against what's already stored (matched by the `submitted_at`
 * unique key), and updates only the rows that differ — nothing else in the
 * row (tallies, location, leader) is touched.
 *
 * Usage:
 *   npx tsx scripts/reconcile_campaign_report_dates.ts <rows.json>            # dry-run summary
 *   npx tsx scripts/reconcile_campaign_report_dates.ts <rows.json> --apply    # actually write
 *
 * Requirements:
 *   .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   <rows.json> produced by scripts/campaign_reports_xlsx_to_json.py
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { normalizeCampaignReportRow, type RawCampaignReportSheetRow } from '../lib/campaignReportParser';

const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});

const apply = process.argv.includes('--apply');
const inputPath = process.argv[2];
if (!inputPath || inputPath === '--apply') {
  console.error('Usage: npx tsx scripts/reconcile_campaign_report_dates.ts <rows.json> [--apply]');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type TaggedValue = { t: 'date' | 'number' | 'string' | 'null'; v: string | number | null };
function revive(tagged: TaggedValue): unknown {
  if (tagged.t === 'date') return new Date(tagged.v as string);
  return tagged.v;
}

interface RawJsonRow {
  submitted_at: TaggedValue;
  location: TaggedValue;
  leader: TaggedValue;
  campaign_date: TaggedValue;
  partial_presentations: TaggedValue;
  full_presentations: TaggedValue;
  sinners_prayer: TaggedValue;
  information_requests: TaggedValue;
}

interface ExistingRow {
  submitted_at: string;
  campaign_date: string | null;
  campaign_date_raw: string | null;
  needs_review: boolean;
}

async function main() {
  const rawRows: RawJsonRow[] = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));

  let existing: ExistingRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('campaign_reports')
      .select('submitted_at, campaign_date, campaign_date_raw, needs_review')
      .range(from, from + 999);
    if (error) { console.error('Fetch failed:', error.code, error.message); process.exit(1); }
    existing = existing.concat(data as ExistingRow[]);
    if (data.length < 1000) break;
    from += 1000;
  }
  // Keyed by epoch millis, not the raw string — Supabase returns
  // "...+00:00" while our own toISOString() produces "...Z"; same instant,
  // different string.
  const bySubmittedAt = new Map(existing.map((r) => [new Date(r.submitted_at).getTime(), r]));
  console.log(`Fetched ${existing.length} existing rows from campaign_reports.`);

  type Update = { submitted_at: string; campaign_date: string | null; campaign_date_raw: string | null; needs_review: boolean };
  const updates: Update[] = [];
  let notFound = 0;

  for (const row of rawRows) {
    const raw: RawCampaignReportSheetRow = {
      submittedAt: revive(row.submitted_at),
      location: revive(row.location),
      leader: revive(row.leader),
      campaignDate: revive(row.campaign_date),
      partialPresentations: revive(row.partial_presentations),
      fullPresentations: revive(row.full_presentations),
      sinnersPrayer: revive(row.sinners_prayer),
      informationRequests: revive(row.information_requests),
    };
    const normalized = normalizeCampaignReportRow(raw);
    if (!normalized) continue;

    const current = bySubmittedAt.get(new Date(normalized.submitted_at).getTime());
    if (!current) {
      notFound++;
      continue;
    }
    if (
      current.campaign_date !== normalized.campaign_date ||
      current.campaign_date_raw !== normalized.campaign_date_raw ||
      current.needs_review !== normalized.needs_review
    ) {
      updates.push({
        submitted_at: normalized.submitted_at,
        campaign_date: normalized.campaign_date,
        campaign_date_raw: normalized.campaign_date_raw,
        needs_review: normalized.needs_review,
      });
    }
  }

  console.log(`\n${updates.length} rows need updating; ${notFound} sheet rows not found in the table (unexpected — investigate before applying).`);
  console.log('\nSample of rows to update:');
  for (const u of updates.slice(0, 10)) {
    const before = bySubmittedAt.get(new Date(u.submitted_at).getTime())!;
    console.log(`  ${u.submitted_at}: campaign_date ${before.campaign_date} -> ${u.campaign_date}, needs_review ${before.needs_review} -> ${u.needs_review}`);
  }

  if (!apply) {
    console.log('\nDry run — no rows written. Re-run with --apply to update campaign_reports.');
    return;
  }
  if (notFound > 0) {
    console.error('\nRefusing to apply: unexpected rows not found in the table. Investigate first.');
    process.exit(1);
  }

  let updated = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from('campaign_reports')
      .update({ campaign_date: u.campaign_date, campaign_date_raw: u.campaign_date_raw, needs_review: u.needs_review })
      .eq('submitted_at', u.submitted_at);
    if (error) {
      console.error(`Update failed for ${u.submitted_at}:`, error.code, error.message);
      process.exit(1);
    }
    updated++;
    if (updated % 25 === 0) console.log(`  ${updated}/${updates.length} updated…`);
  }
  console.log(`\nDone. ${updated} rows updated.`);
}

main();
