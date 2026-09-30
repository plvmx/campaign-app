/**
 * One-off — applies Peter's decision (2026-09-30) on the 67 postcode
 * conflicts flagged by scripts/backfill_postcode_nfc_state_from_sept24_sheet.ts
 * (2026-09-25): the sheet's postcode value wins whenever it disagrees with
 * what's currently in registry.registrants.postcode.
 *
 * One exception, carried forward from that investigation rather than
 * re-decided here: `carolinemusuka@gmail.com`'s sheet value (`5208`) was
 * confirmed NOT to be a real Australian postcode — checked live against
 * two independent postcode databases (Nominatim's structured postcode
 * search and zippopotam.us), neither of which recognize it, while the
 * DB's existing `5024` checks out fine on both. Overwriting a real
 * postcode with a value confirmed non-existent would just be a new,
 * worse error — excluded from this script entirely, reported separately.
 *
 * Re-fetches each registrant's CURRENT postcode fresh (not the 2026-09-25
 * snapshot) before deciding what to write, since a manual /registry/manage
 * edit could plausibly have already resolved one of these in the
 * intervening 5 days — a conflict whose current DB value already matches
 * the sheet is reported as already-resolved, not re-written.
 *
 * SAFETY:
 *  - Defaults to a dry run: prints a summary, writes nothing.
 *  - Always backs up every affected registrant's pre-write state (plus the
 *    intended patch) to backups/ (gitignored) before any write.
 *  - Idempotent: re-running after it has already applied finds nothing
 *    left to update (every row's postcode already matches the sheet).
 *
 * Usage:
 *   npx tsx scripts/apply_postcode_conflicts_sept24_sheet.ts           # dry run
 *   npx tsx scripts/apply_postcode_conflicts_sept24_sheet.ts --apply   # actually update
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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const CONFLICTS_PATH = path.join(__dirname, '..', 'backups', 'postcode_conflicts_sept24_sheet_2026-09-25T02-13-45-743Z.json');
const OUT_DIR = path.join(__dirname, '..', 'backups');

// Confirmed non-existent postcode (see header) — excluded regardless of
// what the conflicts file says.
const KNOWN_INVALID = new Set(['carolinemusuka@gmail.com']);

interface ConflictRow {
  email: string;
  sheetPostcode: string;
  dbPostcode: string;
}

interface Registrant {
  id: string;
  email: string | null;
  postcode: string | null;
}

async function main() {
  const conflicts: ConflictRow[] = JSON.parse(fs.readFileSync(CONFLICTS_PATH, 'utf-8'));
  console.log(`Read ${conflicts.length} conflicts from ${CONFLICTS_PATH}`);

  const toApply = conflicts.filter((c) => !KNOWN_INVALID.has(c.email));
  const skippedInvalid = conflicts.filter((c) => KNOWN_INVALID.has(c.email));
  console.log(`Excluded as a confirmed non-existent postcode: ${skippedInvalid.length}`, skippedInvalid);

  const emails = toApply.map((c) => c.email.trim().toLowerCase());
  const { data, error } = await supabase
    .schema('registry')
    .from('registrants')
    .select('id, email, postcode')
    .in('email', emails);
  if (error) throw error;
  const registrantByEmail = new Map<string, Registrant>();
  for (const r of (data ?? []) as Registrant[]) {
    if (r.email) registrantByEmail.set(r.email.trim().toLowerCase(), r);
  }

  const toUpdate: Array<{ registrant: Registrant; oldPostcode: string | null; newPostcode: string }> = [];
  const alreadyResolved: string[] = [];
  const notFound: string[] = [];
  const driftedSinceSnapshot: Array<{ email: string; snapshotDb: string; currentDb: string }> = [];

  for (const c of toApply) {
    const email = c.email.trim().toLowerCase();
    const registrant = registrantByEmail.get(email);
    if (!registrant) {
      notFound.push(email);
      continue;
    }
    if (registrant.postcode === c.sheetPostcode) {
      alreadyResolved.push(email);
      continue;
    }
    if (registrant.postcode !== c.dbPostcode) {
      driftedSinceSnapshot.push({ email, snapshotDb: c.dbPostcode, currentDb: registrant.postcode ?? '(null)' });
    }
    toUpdate.push({ registrant, oldPostcode: registrant.postcode, newPostcode: c.sheetPostcode });
  }

  console.log('\n--- Summary ---');
  console.log(`To update (sheet postcode wins): ${toUpdate.length}`);
  console.log(`Already resolved (current DB value already matches the sheet): ${alreadyResolved.length}`, alreadyResolved);
  console.log(`No matching registrant found by email: ${notFound.length}`, notFound);
  if (driftedSinceSnapshot.length > 0) {
    console.log(`Current DB value differs from the 2026-09-25 snapshot (still applying the sheet's value regardless): ${driftedSinceSnapshot.length}`, driftedSinceSnapshot);
  }

  if (toUpdate.length === 0) {
    console.log('\nNothing to update.');
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(OUT_DIR, `postcode_conflicts_applied_${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(toUpdate, null, 2));
  console.log(`Backed up affected rows (pre-write state + intended patch) -> ${backupPath}`);

  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'}`);
  console.log('Sample of first 10 updates:');
  for (const { registrant, oldPostcode, newPostcode } of toUpdate.slice(0, 10)) {
    console.log(`  ${registrant.email}: ${oldPostcode} -> ${newPostcode}`);
  }

  if (!apply) {
    console.log('\nRe-run with --apply to actually update.');
    return;
  }

  console.log('\nUpdating registry.registrants...');
  for (const { registrant, newPostcode } of toUpdate) {
    const { error: updateError } = await supabase
      .schema('registry')
      .from('registrants')
      .update({ postcode: newPostcode, last_updated_at: new Date().toISOString() })
      .eq('id', registrant.id);
    if (updateError) throw updateError;
  }
  console.log(`  ${toUpdate.length} registrants updated.`);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
