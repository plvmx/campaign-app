/**
 * One-off — cross-references Jordan's "Unsubscribes" tab (extracted by
 * scripts/jordan_unsubscribes_xlsx_to_json.py into a JSON array of
 * lowercased emails) against registry.registrants, and sets
 * unsubscribed = 'Yes' for every match.
 *
 * Background: registry.registrants.unsubscribed was previously populated
 * only once, from the "UNSUBSCRIBED" marker embedded in Lorraine's
 * spreadsheet's Church column during the 2026-09-08/09 CSV reload — see
 * scripts/prepare_registrants_for_csv_reload.sql. Jordan separately
 * tracks a dedicated "Unsubscribes" tab (part of the same AFJ Tracking
 * export used by the Campaign Report project — see
 * scripts/campaign_reports_xlsx_to_json.py) that was never cross-checked
 * against the registry at all. This closes that gap as a one-off; going
 * forward, an *AC-driven* unsubscribe is now caught live by
 * transform.ts's markRegistrantUnsubscribedByEmail call (see
 * OPERATIONS.md's 2026-09-14 follow-up entry) — this script is for
 * whatever in Jordan's list isn't also reflected in AC's own status.
 *
 * SAFETY:
 *  - Defaults to a dry run: prints a summary, writes nothing.
 *  - Always backs up every matched registrant (before the write) to
 *    backups/ (gitignored).
 *  - --apply actually updates. Only ever sets unsubscribed = 'Yes' —
 *    never clears it, never touches any other column (in particular,
 *    never clears email — see prepare_registrants_for_csv_reload.sql's
 *    comment on why: it must stay matchable if this person is ever seen
 *    again).
 *
 * Usage:
 *   python3 scripts/jordan_unsubscribes_xlsx_to_json.py <input.xlsx> backups/jordan_unsubscribes.json
 *   npx tsx scripts/mark_unsubscribed_from_jordan_sheet.ts backups/jordan_unsubscribes.json           # dry run
 *   npx tsx scripts/mark_unsubscribed_from_jordan_sheet.ts backups/jordan_unsubscribes.json --apply   # actually update
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

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
  throw new Error('Usage: npx tsx scripts/mark_unsubscribed_from_jordan_sheet.ts <emails.json> [--apply]');
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
  first_name: string | null;
  last_name: string | null;
  unsubscribed: string | null;
}

async function main() {
  const jordanEmails: string[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const jordanSet = new Set(jordanEmails.map((e) => e.trim().toLowerCase()));
  console.log(`Jordan's Unsubscribes tab: ${jordanSet.size} unique emails.`);

  console.log('Fetching registry.registrants...');
  const registrants: Registrant[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .schema('registry')
      .from('registrants')
      .select('id, email, first_name, last_name, unsubscribed')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    registrants.push(...(data as Registrant[]));
    if (data.length < PAGE_SIZE) break;
  }
  console.log(`  ${registrants.length} registrants fetched.`);

  const matches = registrants.filter((r) => r.email && jordanSet.has(r.email.trim().toLowerCase()));
  const alreadyFlagged = matches.filter((r) => r.unsubscribed === 'Yes');
  const needsUpdate = matches.filter((r) => r.unsubscribed !== 'Yes');

  console.log(`\nRegistrants matching Jordan's Unsubscribes tab: ${matches.length}`);
  console.log(`  already unsubscribed = 'Yes': ${alreadyFlagged.length}`);
  console.log(`  need updating: ${needsUpdate.length}`);

  if (needsUpdate.length === 0) {
    console.log('Nothing to update.');
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(OUT_DIR, `jordan_unsubscribe_match_${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(needsUpdate, null, 2));
  console.log(`Backed up affected rows -> ${backupPath}`);

  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'}`);
  console.log('\nSample registrants that would be updated:');
  for (const r of needsUpdate.slice(0, 10)) {
    console.log(`  ${r.first_name ?? ''} ${r.last_name ?? ''} <${r.email ?? ''}>`);
  }

  if (!apply) {
    console.log('\nRe-run with --apply to actually update.');
    return;
  }

  console.log('\nUpdating registry.registrants...');
  const ids = needsUpdate.map((r) => r.id);
  for (let i = 0; i < ids.length; i += PAGE_SIZE) {
    const batch = ids.slice(i, i + PAGE_SIZE);
    const { error } = await supabase
      .schema('registry')
      .from('registrants')
      .update({ unsubscribed: 'Yes', last_updated_at: new Date().toISOString() })
      .in('id', batch);
    if (error) throw error;
  }
  console.log(`  ${ids.length} registrants marked unsubscribed.`);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
