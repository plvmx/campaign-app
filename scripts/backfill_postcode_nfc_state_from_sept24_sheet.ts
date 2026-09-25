/**
 * One-off — backfills registry.registrants.postcode / .nfc / .state from
 * Lorraine's updated soulwinners export ("Current AFJ Soulwinners as at 24
 * Sept 2026.xlsx", "main AFJ page" tab), matched by email. Peter's ask
 * (2026-09-25): the sheet has added postcodes that were previously
 * missing, some marked "NFC" (No Further Contact — the person didn't want
 * their location shared), and where a newly-added postcode is valid the
 * sheet's own State column can fill a currently-blank state too.
 *
 * Reuses the exact same transformRow/dedupeByEmail functions the CSV
 * reload/backfill scripts use (extractPostcode already handles the "5NFC"
 * -> {postcode: null, nfc: 'Yes'} pattern this sheet uses, and the
 * "4???"-style masked placeholders this sheet also has plenty of) — never
 * re-implements postcode/NFC parsing independently.
 *
 * Rules, confirmed with Peter before writing this (see the investigation
 * that preceded it — a live diff against production found this is NOT a
 * clean "postcodes were only ever added" situation):
 *   - nfc: sheet says NFC and DB nfc isn't already 'Yes' -> set nfc='Yes'.
 *     Applied regardless of whether DB already has a postcode on file —
 *     NFC never clears an existing postcode, it's purely additive.
 *   - postcode: DB postcode is currently NULL and the sheet has a valid
 *     4-digit postcode -> fill it. Never overwrites an existing DB
 *     postcode, even a different one — 67 such conflicts were found
 *     live and are deliberately EXCLUDED from this script's writes,
 *     reported separately for Peter to review by hand (a spreadsheet
 *     snapshot disagreeing with live data isn't evidence either one is
 *     wrong).
 *   - state: DB state is currently NULL and the sheet's own State column
 *     (this row, not derived from the postcode) is a real AUSTRALIAN_STATES
 *     value -> fill it. Every one of the 54 registrants who'd get both
 *     postcode+state filled from this sheet already has the sheet's own
 *     State column populated, so no postcode-to-state range logic is
 *     needed or used here.
 *
 * SAFETY:
 *  - Defaults to a dry run: prints a summary, writes nothing.
 *  - Always backs up every affected registrant's pre-write state (plus the
 *    intended patch) to backups/ (gitignored) before any write.
 *  - Idempotent: only ever fills a column that is currently NULL (nfc's
 *    'Yes'-only rule is the one exception, and it's still never
 *    overwriting a 'Yes' with anything). Re-running after it has already
 *    applied touches nothing further.
 *
 * Usage:
 *   python3 scripts/afj_soulwinners_sept2026_xlsx_to_json.py "<source.xlsx>" /tmp/afj_sept24.json
 *   npx tsx scripts/backfill_postcode_nfc_state_from_sept24_sheet.ts /tmp/afj_sept24.json           # dry run
 *   npx tsx scripts/backfill_postcode_nfc_state_from_sept24_sheet.ts /tmp/afj_sept24.json --apply    # actually update
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { transformRow, dedupeByEmail, type RawCsvRow, type TransformedRegistrant } from '../lib/registryPipeline/csvRegistrantTransform';
import { AUSTRALIAN_STATES } from '../lib/constants';

const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const jsonPathArg = args.find((a) => !a.startsWith('--'));
if (!jsonPathArg) {
  throw new Error('Usage: npx tsx scripts/backfill_postcode_nfc_state_from_sept24_sheet.ts <sheet-rows.json> [--apply]');
}
const jsonPath: string = jsonPathArg;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const PAGE_SIZE = 1000;
const OUT_DIR = path.join(__dirname, '..', 'backups');

interface Registrant {
  id: string;
  email: string | null;
  postcode: string | null;
  state: string | null;
  nfc: string | null;
}

type Patch = Partial<Pick<Registrant, 'postcode' | 'state' | 'nfc'>>;

const VALID_STATES: readonly string[] = AUSTRALIAN_STATES;

function buildPatch(registrant: Registrant, sheetState: string | null, csv: TransformedRegistrant): Patch {
  const patch: Patch = {};
  if (csv.nfc === 'Yes' && registrant.nfc !== 'Yes') patch.nfc = 'Yes';
  if (registrant.postcode === null && csv.postcode !== null) patch.postcode = csv.postcode;
  if (registrant.state === null && sheetState !== null) patch.state = sheetState;
  return patch;
}

async function main() {
  const rawRows: RawCsvRow[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  console.log(`Read ${rawRows.length} rows from ${jsonPath}`);

  const included: TransformedRegistrant[] = [];
  let excludedNonAuState = 0;
  for (const raw of rawRows) {
    const result = transformRow(raw);
    if (result.status === 'excluded_non_au_state') {
      excludedNonAuState++;
      continue;
    }
    included.push(result.registrant);
  }
  const deduped = dedupeByEmail(included);
  console.log(`Excluded (non-AU state): ${excludedNonAuState}`);
  console.log(`Included after per-row transform + dedupe: ${deduped.length}`);

  // The sheet's own raw State column, per email — kept separately from
  // TransformedRegistrant.state (which is the same value, just already
  // validated/uppercased) so we can double-check it's a real
  // AUSTRALIAN_STATES value before ever writing it, same defensive
  // instinct as everywhere else in this pipeline that touches state.
  const sheetStateByEmail = new Map<string, string | null>();
  for (const r of deduped) {
    if (!r.email) continue;
    const state = r.state && VALID_STATES.includes(r.state) ? r.state : null;
    sheetStateByEmail.set(r.email.trim().toLowerCase(), state);
  }

  const csvByEmail = new Map<string, TransformedRegistrant>();
  for (const r of deduped) {
    if (!r.email) continue;
    csvByEmail.set(r.email.trim().toLowerCase(), r);
  }

  console.log('Fetching registry.registrants...');
  const registrants: Registrant[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .schema('registry')
      .from('registrants')
      .select('id, email, postcode, state, nfc')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    registrants.push(...(data as Registrant[]));
    if (data.length < PAGE_SIZE) break;
  }
  console.log(`  ${registrants.length} registrants fetched.`);

  const toUpdate: Array<{ registrant: Registrant; patch: Patch }> = [];
  const postcodeConflicts: Array<{ email: string; sheetPostcode: string; dbPostcode: string }> = [];

  for (const registrant of registrants) {
    if (!registrant.email) continue;
    const email = registrant.email.trim().toLowerCase();
    const csv = csvByEmail.get(email);
    if (!csv) continue;

    // Flag (don't apply) a genuine postcode conflict — DB already has a
    // different valid postcode than the sheet. Reported separately; never
    // included in toUpdate.
    if (registrant.postcode !== null && csv.postcode !== null && csv.postcode !== registrant.postcode) {
      postcodeConflicts.push({ email, sheetPostcode: csv.postcode, dbPostcode: registrant.postcode });
    }

    const sheetState = sheetStateByEmail.get(email) ?? null;
    const patch = buildPatch(registrant, sheetState, csv);
    if (Object.keys(patch).length > 0) {
      toUpdate.push({ registrant, patch });
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Matched registrants needing an update: ${toUpdate.length}`);
  console.log(`Postcode conflicts (DB has a different postcode already — NOT applied, review separately): ${postcodeConflicts.length}`);

  const fieldCounts = { postcode: 0, state: 0, nfc: 0 };
  for (const { patch } of toUpdate) {
    for (const key of Object.keys(patch) as Array<keyof Patch>) fieldCounts[key]++;
  }
  console.log('Fields to be set:', fieldCounts);

  if (postcodeConflicts.length > 0) {
    const conflictsPath = path.join(OUT_DIR, `postcode_conflicts_sept24_sheet_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(conflictsPath, JSON.stringify(postcodeConflicts, null, 2));
    console.log(`Postcode conflicts written for manual review -> ${conflictsPath}`);
  }

  if (toUpdate.length === 0) {
    console.log('\nNothing to update.');
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(OUT_DIR, `postcode_nfc_state_backfill_${stamp}.json`);
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
