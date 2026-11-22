/**
 * One-off — brings registry.registrants back in line with Lorraine's
 * "Current AFJ Soulwinners as at 24 Sept 2026" sheet (2026-10-27
 * investigation, triggered by two people she re-registered by hand and a
 * count that looked 60 short). Three parts, all planned by
 * lib/registryPipeline/sheetRestorePlan.ts:
 *
 *  1. RESTORE — sheet people the 2026-09-14 List [2] migration moved into
 *     registry.twol_respondents. That script assumed CSV-loaded registrants
 *     could never look "List [2] only", but an ac-sync run between the
 *     reload and the migration gave them List [2] events, so they were moved
 *     (and deleted from registrants). Inserted back from the sheet. The
 *     twol_respondents rows are left alone — they are an append-only record
 *     of what AC reported, not a claim about registration.
 *  2. IMPORT — Australian people added to the sheet after the September CSV
 *     export: neither the reload nor ac-sync (they aren't in AC) ever saw
 *     them. Inserted from the sheet. Overseas (OS/NZ/UK) rows stay excluded,
 *     as decided for the reload.
 *  3. NAME CORRECTION — a registrant whose AC contact has the placeholder
 *     email noemail@noemail.com keeps the name first pinned by the sync
 *     (registrantNameGuard), and can't be matched by email. If exactly one
 *     sheet row shares its phone, its first/last name are corrected and the
 *     change logged to registry.registrant_edits. The email is NOT changed:
 *     the next ac-sync for that AC contact would just recreate a placeholder
 *     row. Fix the email in ActiveCampaign instead.
 *
 * SAFETY:
 *  - Dry run by default: prints the full plan, writes nothing.
 *  - Always writes a backup (planned inserts + pre-change state of every row
 *    to be corrected) to backups/ (gitignored) before any write.
 *  - Idempotent: the plan is recomputed from live data at --apply time and
 *    anything already in the registry is skipped, so a re-run inserts nothing.
 *  - Never deletes anything.
 *
 * Usage:
 *   python3 scripts/afj_soulwinners_sept2026_xlsx_to_json.py "<source.xlsx>" /tmp/afj_sept24.json
 *   npx tsx scripts/restore_missing_registrants_from_sheet.ts /tmp/afj_sept24.json           # dry run
 *   npx tsx scripts/restore_missing_registrants_from_sheet.ts /tmp/afj_sept24.json --apply
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import type { RawCsvRow } from '../lib/registryPipeline/csvRegistrantTransform';
import {
  planSheetRestore,
  toRegistrantInsertRow,
  type ExistingRegistrant,
  type TwolRespondentRef,
  type SheetRestorePlan,
} from '../lib/registryPipeline/sheetRestorePlan';

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
  throw new Error('Usage: npx tsx scripts/restore_missing_registrants_from_sheet.ts <sheet-rows.json> [--apply]');
}
const jsonPath: string = jsonPathArg;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const PAGE_SIZE = 1000;
const BATCH_SIZE = 200;
const OUT_DIR = path.join(__dirname, '..', 'backups');

// national_admin attributed on the registrant_edits rows (same as
// scripts/fix_test_data_overwritten_names.ts).
const EDITOR_USER_ID = '6806baba-b978-4000-9a20-eabcca27386f';
const EDITOR_EMAIL = 'plvmx01@gmail.com';

async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .schema('registry')
      .from(table)
      .select(columns)
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as unknown as T[]));
    if (data.length < PAGE_SIZE) break;
  }
  return out;
}

async function buildPlan(sheetRows: RawCsvRow[]): Promise<SheetRestorePlan> {
  const registrants = await fetchAll<ExistingRegistrant>('registrants', 'id, first_name, last_name, email, phone, ac_contact_id');
  const twol = await fetchAll<TwolRespondentRef & { id: number }>('twol_respondents', 'id, first_name, last_name, email, phone');
  console.log(`Registry now holds ${registrants.length} registrants and ${twol.length} twol_respondents rows.`);
  return planSheetRestore(sheetRows, registrants, twol);
}

const fmt = (v: string | null) => v ?? '—';

function printPlan(plan: SheetRestorePlan) {
  const restore = plan.inserts.filter((i) => i.kind === 'restore');
  const imports = plan.inserts.filter((i) => i.kind === 'import');
  const skippedBy = (reason: string) => plan.skipped.filter((s) => s.reason === reason);

  console.log('\n=== SUMMARY ===');
  console.log(`  RESTORE (moved to twol_respondents by the 14 Sept migration): ${restore.length}`);
  console.log(`  IMPORT  (on the sheet, never in the registry):                ${imports.length}`);
  console.log(`  NAME CORRECTIONS:                                             ${plan.nameCorrections.length}`);
  console.log('  Skipped:');
  for (const reason of ['already_in_registry', 'overseas', 'same_name_in_registry', 'no_contact_details', 'handled_by_name_correction', 'unrecognised_state', 'blank_or_header']) {
    console.log(`    ${reason}: ${skippedBy(reason).length}`);
  }

  const line = (i: SheetRestorePlan['inserts'][number]) => {
    const r = i.registrant;
    const flags = [r.unsubscribed === 'Yes' ? 'UNSUB' : '', r.nfc === 'Yes' ? 'NFC' : ''].filter(Boolean).join(',');
    const notes = i.notes.length ? `  !! ${i.notes.join('; ')}` : '';
    return `  sheet line ${String(i.sourceLines.join('+')).padEnd(5)} ${`${r.firstName ?? ''} ${r.lastName ?? ''}`.trim().padEnd(28)} ${fmt(r.email).padEnd(36)} ${fmt(r.phoneRaw).padEnd(14)} ${fmt(r.state).padEnd(4)} ${fmt(r.postcode).padEnd(5)} regd ${(r.registeredAt ?? '—').slice(0, 10)} ${flags}${notes}`;
  };

  console.log(`\n=== RESTORE (${restore.length}) ===`);
  restore.forEach((i) => console.log(line(i)));
  console.log(`\n=== IMPORT (${imports.length}) ===`);
  imports.forEach((i) => console.log(line(i)));

  console.log('\n=== NAME CORRECTIONS (email is left untouched — fix it in ActiveCampaign) ===');
  if (plan.nameCorrections.length === 0) console.log('  none');
  for (const c of plan.nameCorrections) {
    console.log(`  registrant ${c.registrantId} (AC contact ${fmt(c.acContactId)}): "${fmt(c.currentFirstName)} ${fmt(c.currentLastName)}" -> "${c.newFirstName} ${c.newLastName}"  (sheet line ${c.sheetLine})`);
  }

  console.log('\n=== SKIPPED — worth a look ===');
  for (const reason of ['same_name_in_registry', 'no_contact_details', 'unrecognised_state', 'blank_or_header'] as const) {
    skippedBy(reason).forEach((s) => console.log(`  ${reason}: sheet line ${s.row.lineNumber} ${s.row.firstName} ${s.row.lastName} ${s.detail ?? ''}`));
  }
}

async function main() {
  const sheetRows: RawCsvRow[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  console.log(`Read ${sheetRows.length} sheet rows from ${jsonPath}`);

  const plan = await buildPlan(sheetRows);
  printPlan(plan);

  const registrantIds = plan.nameCorrections.map((c) => c.registrantId);
  const before = registrantIds.length
    ? (await supabase.schema('registry').from('registrants').select('*').in('id', registrantIds)).data ?? []
    : [];

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(OUT_DIR, `restore_missing_registrants_${stamp}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify({ plannedInserts: plan.inserts.map((i) => ({ kind: i.kind, row: toRegistrantInsertRow(i.registrant), sourceLines: i.sourceLines })), nameCorrections: plan.nameCorrections, registrantsBefore: before }, null, 2),
  );
  console.log(`\nBacked up the plan + current state of rows to be corrected -> ${backupPath}`);

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to write.');
    return;
  }

  const rows = plan.inserts.map((i) => toRegistrantInsertRow(i.registrant));
  console.log(`\nInserting ${rows.length} registrants in batches of ${BATCH_SIZE}...`);
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const { error } = await supabase.schema('registry').from('registrants').insert(rows.slice(i, i + BATCH_SIZE));
    if (error) throw error;
    console.log(`  inserted ${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length}`);
  }

  for (const c of plan.nameCorrections) {
    // Only touch the row if it still has the exact name the plan saw.
    const { data, error } = await supabase
      .schema('registry')
      .from('registrants')
      .update({ first_name: c.newFirstName, last_name: c.newLastName })
      .eq('id', c.registrantId)
      .eq('first_name', c.currentFirstName ?? '')
      .eq('last_name', c.currentLastName ?? '')
      .select('id');
    if (error) throw error;
    if (!data?.length) {
      console.log(`  skipped name correction for ${c.registrantId} — its name changed since the plan was made.`);
      continue;
    }
    const edits = [
      { registrant_id: c.registrantId, field: 'first_name', old_value: c.currentFirstName, new_value: c.newFirstName, edited_by: EDITOR_USER_ID, edited_by_email: EDITOR_EMAIL },
      { registrant_id: c.registrantId, field: 'last_name', old_value: c.currentLastName, new_value: c.newLastName, edited_by: EDITOR_USER_ID, edited_by_email: EDITOR_EMAIL },
    ];
    const { error: editError } = await supabase.schema('registry').from('registrant_edits').insert(edits);
    if (editError) throw editError;
    console.log(`  corrected ${c.registrantId} and logged ${edits.length} registrant_edits rows.`);
  }

  const { count } = await supabase.schema('registry').from('registrants').select('*', { count: 'exact', head: true });
  console.log(`\nDone. registry.registrants now holds ${count} rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
