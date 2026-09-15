/**
 * One-off — backfills webinar_session_at / webinar_attended /
 * code_of_conduct_agreed / code_of_conduct_agreed_at on already-loaded
 * registry.registrants rows from Lorraine's CSV export, matched by email.
 *
 * Background: the 2026-09-08/09 CSV reload (reload_registrants_from_csv.ts)
 * deliberately did not read these four columns — see that script's
 * COLUMNS comment and scripts/add_webinar_and_code_fields_to_registrants.sql
 * for why they're now needed. This script is the incremental (UPDATE-only)
 * counterpart for the ~9,128 registrants already loaded before that need
 * emerged; reload_registrants_from_csv.ts itself is a full truncate+reload
 * tool and refuses to run against a non-empty table, so it is NOT the
 * route for backfilling existing data.
 *
 * Reuses the exact same transformRow/dedupeByEmail functions the reload
 * used, so the email set and merge decisions match what is already in the
 * table today — never re-implements CSV parsing independently.
 *
 * SAFETY:
 *  - Defaults to a dry run: prints a summary, writes nothing.
 *  - Always backs up every affected registrant's pre-write state (plus the
 *    intended patch) to backups/ (gitignored) before any write.
 *  - Idempotent and non-destructive: only ever fills a column that is
 *    currently NULL with a non-null CSV value. Never clears a value, and
 *    never overwrites a value already present — in particular, never
 *    overwrites anything ac-sync has already derived live from AC tags
 *    (see ports.ts's upsertRegistrant doc comment on the clobber rule).
 *    Re-running this script after it has already applied touches nothing.
 *  - Run AFTER the SQL migration and, ideally, after ac-sync has been
 *    redeployed and had at least one sync cycle — see that migration's
 *    header and the PR description for the recommended ordering.
 *
 * Usage:
 *   npx tsx scripts/backfill_webinar_and_code_fields_from_csv.ts [csv-path]           # dry run
 *   npx tsx scripts/backfill_webinar_and_code_fields_from_csv.ts [csv-path] --apply   # actually update
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { parseCsv, stripBom } from '../lib/registryPipeline/csvParse';
import { transformRow, dedupeByEmail, type RawCsvRow, type TransformedRegistrant } from '../lib/registryPipeline/csvRegistrantTransform';

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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// Same column indices as reload_registrants_from_csv.ts's COLUMNS — kept
// as an independent local copy rather than shared, since this script and
// the reload script are otherwise unrelated one-off tools.
const COLUMNS = {
  firstName: 0, lastName: 1, email: 2, phone: 3, state: 4, postcode: 5,
  church: 6, regd: 9, webinar: 10, webinarDone: 11, code: 15, dateAgreed: 16,
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
    webinar: cells[COLUMNS.webinar] ?? '',
    webinarDone: cells[COLUMNS.webinarDone] ?? '',
    code: cells[COLUMNS.code] ?? '',
    dateAgreed: cells[COLUMNS.dateAgreed] ?? '',
    lineNumber,
  };
}

const PAGE_SIZE = 1000;
const OUT_DIR = path.join(__dirname, '..', 'backups');

interface Registrant {
  id: string;
  email: string | null;
  webinar_session_at: string | null;
  webinar_attended: string | null;
  code_of_conduct_agreed: string | null;
  code_of_conduct_agreed_at: string | null;
}

type Patch = Partial<Pick<Registrant, 'webinar_session_at' | 'webinar_attended' | 'code_of_conduct_agreed' | 'code_of_conduct_agreed_at'>>;

function buildPatch(registrant: Registrant, csv: TransformedRegistrant): Patch {
  const patch: Patch = {};
  if (registrant.webinar_session_at === null && csv.webinarSessionAt !== null) patch.webinar_session_at = csv.webinarSessionAt;
  if (registrant.webinar_attended === null && csv.webinarAttended !== null) patch.webinar_attended = csv.webinarAttended;
  if (registrant.code_of_conduct_agreed === null && csv.codeOfConductAgreed !== null) patch.code_of_conduct_agreed = csv.codeOfConductAgreed;
  if (registrant.code_of_conduct_agreed_at === null && csv.codeOfConductAgreedAt !== null) patch.code_of_conduct_agreed_at = csv.codeOfConductAgreedAt;
  return patch;
}

async function main() {
  const text = stripBom(fs.readFileSync(csvPath, 'utf-8'));
  const allRows = parseCsv(text);
  const [, ...dataRows] = allRows;
  console.log(`Read ${dataRows.length} data rows from ${csvPath}`);

  const included: TransformedRegistrant[] = [];
  dataRows.forEach((cells, i) => {
    const raw = toRawRow(cells, i + 2);
    const result = transformRow(raw);
    if (result.status === 'included') included.push(result.registrant);
  });
  const deduped = dedupeByEmail(included);

  const csvByEmail = new Map<string, TransformedRegistrant>();
  let unmatchableNoEmail = 0;
  for (const r of deduped) {
    if (!r.email) {
      // Either genuinely had no email in the CSV, or had its email cleared
      // by dedupeByEmail's owner-sub-group rule. Either way, this script
      // only matches by email — count and report, never guess by name/phone.
      if (r.webinarSessionAt || r.webinarAttended || r.codeOfConductAgreed || r.codeOfConductAgreedAt) unmatchableNoEmail++;
      continue;
    }
    csvByEmail.set(r.email.trim().toLowerCase(), r);
  }
  console.log(`CSV rows with at least one of the four fields but no matchable email: ${unmatchableNoEmail}`);

  console.log('Fetching registry.registrants...');
  const registrants: Registrant[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .schema('registry')
      .from('registrants')
      .select('id, email, webinar_session_at, webinar_attended, code_of_conduct_agreed, code_of_conduct_agreed_at')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    registrants.push(...(data as Registrant[]));
    if (data.length < PAGE_SIZE) break;
  }
  console.log(`  ${registrants.length} registrants fetched.`);

  const toUpdate: Array<{ registrant: Registrant; patch: Patch }> = [];
  let matchedNoOp = 0;
  let unmatchedCsvEmails = 0;

  for (const registrant of registrants) {
    if (!registrant.email) continue;
    const csv = csvByEmail.get(registrant.email.trim().toLowerCase());
    if (!csv) continue;
    const patch = buildPatch(registrant, csv);
    if (Object.keys(patch).length === 0) {
      matchedNoOp++;
      continue;
    }
    toUpdate.push({ registrant, patch });
  }

  const registrantEmails = new Set(registrants.map((r) => r.email?.trim().toLowerCase()).filter((e): e is string => !!e));
  for (const email of csvByEmail.keys()) {
    if (!registrantEmails.has(email)) unmatchedCsvEmails++;
  }

  console.log('\n--- Summary ---');
  console.log(`CSV rows with an email and at least one of the four fields: ${csvByEmail.size}`);
  console.log(`Matched registrants already fully populated (no-op): ${matchedNoOp}`);
  console.log(`Matched registrants needing an update: ${toUpdate.length}`);
  console.log(`CSV emails with no matching registrant row: ${unmatchedCsvEmails}`);

  const fieldCounts = { webinar_session_at: 0, webinar_attended: 0, code_of_conduct_agreed: 0, code_of_conduct_agreed_at: 0 };
  for (const { patch } of toUpdate) {
    for (const key of Object.keys(patch) as Array<keyof Patch>) fieldCounts[key]++;
  }
  console.log('Fields to be set:', fieldCounts);

  if (toUpdate.length === 0) {
    console.log('\nNothing to update.');
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(OUT_DIR, `webinar_code_backfill_${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(toUpdate, null, 2));
  console.log(`Backed up affected rows (pre-write state + intended patch) -> ${backupPath}`);

  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'}`);
  console.log('Sample of first 10 updates:');
  for (const { registrant, patch } of toUpdate.slice(0, 10)) {
    console.log(`  ${registrant.email}:`, patch);
  }

  if (!apply) {
    console.log('\nRe-run with --apply to actually update.');
    return;
  }

  console.log('\nUpdating registry.registrants...');
  for (const { registrant, patch } of toUpdate) {
    const { error } = await supabase
      .schema('registry')
      .from('registrants')
      .update({ ...patch, last_updated_at: new Date().toISOString() })
      .eq('id', registrant.id);
    if (error) throw error;
  }
  console.log(`  ${toUpdate.length} registrants updated.`);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
