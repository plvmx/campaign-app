/**
 * Campaign Report project — see docs/campaign-report/BRIEF.md.
 *
 * Loads rows produced by scripts/campaign_reports_xlsx_to_json.py into the
 * `campaign_reports` table (scripts/create_campaign_reports_table.sql must
 * already have been run in the Supabase SQL Editor). Used for both:
 *   - the initial historical load (once), and
 *   - the later incremental catch-up dump (phase 2) — safe to re-run against
 *     an export that overlaps already-loaded rows, since it upserts on the
 *     table's `submitted_at` unique constraint and ignores duplicates.
 *
 * Usage:
 *   npx tsx scripts/import_campaign_reports.ts <rows.json>            # dry-run summary
 *   npx tsx scripts/import_campaign_reports.ts <rows.json> --apply    # actually write
 *
 * Requirements:
 *   .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   <rows.json> produced by scripts/campaign_reports_xlsx_to_json.py
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import {
  normalizeCampaignReportRow,
  type RawCampaignReportSheetRow,
  type CampaignReportInsert,
} from '../lib/campaignReportParser';

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
  console.error('Usage: npx tsx scripts/import_campaign_reports.ts <rows.json> [--apply]');
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

async function main() {
  const rawRows: RawJsonRow[] = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));

  const inserts: CampaignReportInsert[] = [];
  let skipped = 0;
  const skippedSamples: RawJsonRow[] = [];

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
    if (!normalized) {
      skipped++;
      if (skippedSamples.length < 5) skippedSamples.push(row);
      continue;
    }
    inserts.push(normalized);
  }

  const needsReviewCount = inserts.filter((r) => r.needs_review).length;

  console.log(`Parsed ${rawRows.length} sheet rows:`);
  console.log(`  ${inserts.length} ready to load`);
  console.log(`  ${skipped} skipped (no usable submitted_at — cannot de-dup, see BRIEF.md)`);
  console.log(`  ${needsReviewCount} of those flagged needs_review (a date or tally couldn't be confidently parsed)`);
  if (skippedSamples.length) {
    console.log('\nSkipped row samples:', JSON.stringify(skippedSamples, null, 2));
  }

  if (!apply) {
    console.log('\nDry run — no rows written. Re-run with --apply to load into campaign_reports.');
    return;
  }

  const BATCH_SIZE = 500;
  let totalInserted = 0;
  for (let i = 0; i < inserts.length; i += BATCH_SIZE) {
    const batch = inserts.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from('campaign_reports')
      .upsert(batch, { onConflict: 'submitted_at', ignoreDuplicates: true })
      .select('id');
    if (error) {
      console.error(`Batch ${i / BATCH_SIZE + 1} failed:`, error.code, error.message, error.details, error.hint);
      process.exit(1);
    }
    totalInserted += data?.length ?? 0;
    console.log(`Batch ${i / BATCH_SIZE + 1}: ${data?.length ?? 0} new rows (of ${batch.length} attempted)`);
  }

  console.log(`\nDone. ${totalInserted} new rows inserted, ${inserts.length - totalInserted} already present (skipped as duplicates).`);
}

main();
