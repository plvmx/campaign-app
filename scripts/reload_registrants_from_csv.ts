/**
 * Registrations reload — replaces registry.registrants /
 * registry.registration_events entirely with Lorraine's CSV export. See
 * docs/registry-pipeline/OPERATIONS.md's two 2026-09-07 entries for the
 * full decision history this implements.
 *
 * Thin I/O layer only — every actual rule (state exclusion, NFC/postcode,
 * unsubscribed/church, date parsing, email-based de-duplication) lives in
 * lib/registryPipeline/csvRegistrantTransform.ts and is unit tested there.
 *
 * SAFETY:
 *  - Defaults to a dry run: prints a summary, writes nothing.
 *  - --apply inserts the transformed rows into registry.registrants. It
 *    does NOT truncate anything itself (this script only ever INSERTs —
 *    no DELETE/TRUNCATE, deliberately, since supabase-js/PostgREST has no
 *    real TRUNCATE and an unconditional DELETE isn't something a script
 *    should do quietly). Run these two, in order, first:
 *      1. npx tsx scripts/backup_registrants_before_reload.ts
 *      2. scripts/prepare_registrants_for_csv_reload.sql, then
 *         scripts/truncate_registrants_before_reload.sql, both in the
 *         Supabase SQL Editor
 *    This script checks registry.registrants is actually empty before
 *    inserting anything and refuses (with the same instructions) if not.
 *
 * Usage:
 *   npx tsx scripts/reload_registrants_from_csv.ts [csv-path]           # dry run
 *   npx tsx scripts/reload_registrants_from_csv.ts [csv-path] --apply   # actually insert
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { parseCsv, stripBom } from '../lib/registryPipeline/csvParse';
import { transformRow, dedupeByEmail, type RawCsvRow, type TransformedRegistrant } from '../lib/registryPipeline/csvRegistrantTransform';
import { normalizePhone } from '../lib/registryPipeline/phone';

const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});

const DEFAULT_CSV_PATH = '/home/peterv/Documents/AFJ Registrations.csv';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const csvPath = args.find((a) => !a.startsWith('--')) ?? DEFAULT_CSV_PATH;

const PRE_APPLY_INSTRUCTIONS = [
  '1. npx tsx scripts/backup_registrants_before_reload.ts',
  '2. scripts/prepare_registrants_for_csv_reload.sql (Supabase SQL Editor)',
  '3. scripts/truncate_registrants_before_reload.sql (Supabase SQL Editor)',
].join('\n  ');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// Column order in AFJ Registrations.csv (and the earlier xlsx before it) —
// see OPERATIONS.md. Columns beyond index 17 are blank-header trailing
// artifacts, deliberately not read here (decision: ignore the second
// Training column and the six workflow-tracking columns).
const COLUMNS = {
  firstName: 0, lastName: 1, email: 2, phone: 3, state: 4, postcode: 5,
  church: 6, training: 7, leader: 8, regd: 9,
} as const;

function toRawRow(cells: string[], lineNumber: number): RawCsvRow {
  return {
    firstName: cells[COLUMNS.firstName] ?? '',
    lastName: cells[COLUMNS.lastName] ?? '',
    email: cells[COLUMNS.email] ?? '',
    phone: cells[COLUMNS.phone] ?? '',
    state: cells[COLUMNS.state] ?? '',
    postcode: cells[COLUMNS.postcode] ?? '',
    church: cells[COLUMNS.church] ?? '',
    regd: cells[COLUMNS.regd] ?? '',
    lineNumber,
  };
}

const BATCH_SIZE = 500;

async function main() {
  const text = stripBom(fs.readFileSync(csvPath, 'utf-8'));
  const allRows = parseCsv(text);
  const [header, ...dataRows] = allRows;
  console.log(`Read ${dataRows.length} data rows from ${csvPath}`);
  console.log(`Header: ${header.slice(0, 10).join(', ')}...`);

  const included: TransformedRegistrant[] = [];
  let excludedNonAuState = 0;

  dataRows.forEach((cells, i) => {
    const lineNumber = i + 2; // +1 for header, +1 for 1-indexing
    const raw = toRawRow(cells, lineNumber);
    const result = transformRow(raw);
    if (result.status === 'excluded_non_au_state') {
      excludedNonAuState++;
      return;
    }
    included.push(result.registrant);
  });

  const deduped = dedupeByEmail(included);
  const unsubscribedCount = deduped.filter((r) => r.unsubscribed === 'Yes').length;
  const nfcCount = deduped.filter((r) => r.nfc === 'Yes').length;
  const noEmailCount = deduped.filter((r) => !r.email).length;

  console.log('\n--- Summary ---');
  console.log(`Excluded (non-AU state): ${excludedNonAuState}`);
  console.log(`Included after per-row transform: ${included.length}`);
  console.log(`After email-based de-duplication: ${deduped.length} (merged ${included.length - deduped.length} rows)`);
  console.log(`  unsubscribed: ${unsubscribedCount}`);
  console.log(`  nfc: ${nfcCount}`);
  console.log(`  no email at all: ${noEmailCount}`);

  if (!apply) {
    console.log('\nDry run — pass --apply to actually insert (after completing the pre-apply steps in the header comment).');
    console.log('Sample of first 3 rows that would be inserted:');
    console.log(JSON.stringify(deduped.slice(0, 3), null, 2));
    return;
  }

  const { count, error: countError } = await supabase
    .schema('registry')
    .from('registrants')
    .select('*', { count: 'exact', head: true });
  if (countError) throw countError;
  if (count && count > 0) {
    console.error(`registry.registrants still has ${count} row(s) — refusing to insert on top of it.`);
    console.error(`Complete these steps first, in order, then re-run with --apply:\n  ${PRE_APPLY_INSTRUCTIONS}`);
    process.exit(1);
  }

  console.log(`\nregistry.registrants is empty — inserting ${deduped.length} registrants in batches of ${BATCH_SIZE}...`);
  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const batch = deduped.slice(i, i + BATCH_SIZE).map((r) => ({
      ac_contact_id: null,
      first_name: r.firstName,
      last_name: r.lastName,
      // Lower-cased at the write boundary — see prepare_registrants_for_csv_reload.sql's
      // note on why the unique index is a plain column, not lower(email).
      email: r.email ? r.email.toLowerCase() : null,
      phone: normalizePhone(r.phoneRaw),
      phone_raw: r.phoneRaw,
      state: r.state,
      postcode: r.postcode,
      church_name: r.churchName,
      registered_at: r.registeredAt,
      unsubscribed: r.unsubscribed,
      nfc: r.nfc,
    }));
    const { error } = await supabase.schema('registry').from('registrants').insert(batch);
    if (error) throw error;
    console.log(`  inserted ${Math.min(i + BATCH_SIZE, deduped.length)} / ${deduped.length}`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
