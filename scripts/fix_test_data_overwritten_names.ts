/**
 * One-off data correction — restores the 5 registry.registrants rows
 * confirmed (2026-09-17 investigation, see CLAUDE.md's "a later sync can
 * no longer silently overwrite a registrant's name" follow-up) to have
 * had their first_name/last_name replaced by a test/placeholder
 * submission under the same real email, sometime after the 2026-09-08/09
 * CSV reload. Confirmed by diffing every live registrant against the
 * original CSV baseline (/home/peterv/Documents/AFJ Registrations.csv) —
 * these 5 are the only ones where the CSV had a real name and live now
 * shows an obvious placeholder. Two other name mismatches surfaced in the
 * same investigation (arunmavai@gmail.com, efunkay@hotmail.com) look like
 * they could be a different real household member overwriting the name
 * rather than test data, and are deliberately left untouched here pending
 * a closer look.
 *
 * Restoring these can't be clobbered again by a future sync — db.ts's
 * upsertRegistrant now runs every update through
 * lib/registryPipeline/registrantNameGuard.ts, which never overwrites a
 * non-blank name.
 *
 * Writes a registry.registrant_edits row per field changed, same as a
 * manual correction from /registry/manage's Edit mode would, attributed
 * to the national_admin who authorized this fix (Peter — see the
 * registry.leader_roles lookup below).
 *
 * SAFETY:
 *  - Defaults to a dry run: prints what would change, writes nothing.
 *  - Always backs up the 5 affected rows' current state to backups/
 *    (gitignored) before any write, dry run or not.
 *  - Re-verifies each row's current email + current (bad) name against
 *    what the investigation found before touching it — refuses a row
 *    that doesn't match, rather than overwriting blind.
 *  - --apply actually updates. Idempotent: re-running after a successful
 *    apply finds nothing left to fix (current name already matches
 *    target) and is a no-op.
 *
 * Usage:
 *   npx tsx scripts/fix_test_data_overwritten_names.ts           # dry run
 *   npx tsx scripts/fix_test_data_overwritten_names.ts --apply   # actually fix
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

const apply = process.argv.includes('--apply');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const OUT_DIR = path.join(__dirname, '..', 'backups');

// The national_admin who reviewed the investigation and authorized this
// fix — attributed on every registrant_edits row written below, same as
// the edited_by/edited_by_email columns a manual Edit-mode save would set.
// (registry.leader_roles user_id for plvmx01@gmail.com.)
const EDITOR_USER_ID = '6806baba-b978-4000-9a20-eabcca27386f';
const EDITOR_EMAIL = 'plvmx01@gmail.com';

interface Correction {
  registrantId: string;
  email: string;
  expectedCurrentFirstName: string;
  expectedCurrentLastName: string;
  correctFirstName: string;
  correctLastName: string;
}

const CORRECTIONS: Correction[] = [
  {
    registrantId: '61a08576-b69a-49cf-8766-e96f1fa3a5c9',
    email: 'lorrainewalker1@outlook.com',
    expectedCurrentFirstName: 'Test',
    expectedCurrentLastName: 'Testing',
    correctFirstName: 'Lorraine',
    correctLastName: 'Walker',
  },
  {
    registrantId: '674e96e0-8c07-4b05-9cc3-010a98ef190e',
    email: 'david.chellappa@gmail.com',
    expectedCurrentFirstName: 'Test David',
    expectedCurrentLastName: 'Test Chellappa',
    correctFirstName: 'David',
    correctLastName: 'Chellappa',
  },
  {
    registrantId: '9a04d7cb-e695-4617-b7cc-6acb97087243',
    email: 'plvmx01@gmail.com',
    expectedCurrentFirstName: 'test',
    expectedCurrentLastName: 'ME',
    correctFirstName: 'Peter',
    correctLastName: 'Viertmann',
  },
  {
    registrantId: 'ac068176-13ff-432e-9d2f-f22654f3f26a',
    email: 'pete_southam@outlook.com',
    expectedCurrentFirstName: 'Test',
    expectedCurrentLastName: 'Test',
    correctFirstName: 'Peter',
    correctLastName: 'Southam',
  },
  {
    registrantId: 'PLACEHOLDER_SABRINA_TASSONE_ID',
    email: 'stassone2006@yahoo.com.au',
    expectedCurrentFirstName: 'Sabrina (This is just a test)',
    expectedCurrentLastName: 'Tassone',
    correctFirstName: 'Sabrina',
    correctLastName: 'Tassone',
  },
];

async function main() {
  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} — restoring ${CORRECTIONS.length} registrant name(s) to their CSV-verified value.\n`);

  const { data: editorData, error: editorErr } = await supabase.auth.admin.getUserById(EDITOR_USER_ID);
  if (editorErr) throw editorErr;
  if (!editorData.user || editorData.user.email !== EDITOR_EMAIL) {
    throw new Error(`auth.users row ${EDITOR_USER_ID} doesn't match ${EDITOR_EMAIL} — check EDITOR_USER_ID/EDITOR_EMAIL.`);
  }
  const editorUser = editorData.user;

  const { data: liveRows, error: fetchError } = await supabase
    .schema('registry')
    .from('registrants')
    .select('id, first_name, last_name, email')
    .in('id', CORRECTIONS.map((c) => c.registrantId).filter((id) => id !== 'PLACEHOLDER_SABRINA_TASSONE_ID'));
  if (fetchError) throw fetchError;

  const byId = new Map((liveRows as { id: string; first_name: string | null; last_name: string | null; email: string | null }[]).map((r) => [r.id, r]));

  // Sabrina's id wasn't captured during the earlier investigation — look it
  // up by email instead, then verify the same way as the others.
  const sabrina = CORRECTIONS.find((c) => c.registrantId === 'PLACEHOLDER_SABRINA_TASSONE_ID')!;
  const { data: sabrinaRow, error: sabrinaErr } = await supabase
    .schema('registry')
    .from('registrants')
    .select('id, first_name, last_name, email')
    .eq('email', sabrina.email)
    .maybeSingle();
  if (sabrinaErr) throw sabrinaErr;
  if (!sabrinaRow) throw new Error(`No registrant found for ${sabrina.email}`);
  sabrina.registrantId = (sabrinaRow as { id: string }).id;
  byId.set(sabrina.registrantId, sabrinaRow as { id: string; first_name: string | null; last_name: string | null; email: string | null });

  const toFix: Correction[] = [];
  for (const c of CORRECTIONS) {
    const row = byId.get(c.registrantId);
    if (!row) {
      console.log(`SKIP ${c.email} — no registrant row found for id ${c.registrantId}.`);
      continue;
    }
    if (row.email?.toLowerCase() !== c.email.toLowerCase()) {
      console.log(`SKIP ${c.email} — row ${c.registrantId} now has a different email (${row.email}). Not touching it.`);
      continue;
    }
    const alreadyCorrect = row.first_name === c.correctFirstName && row.last_name === c.correctLastName;
    if (alreadyCorrect) {
      console.log(`SKIP ${c.email} — already reads "${c.correctFirstName} ${c.correctLastName}". Nothing to do.`);
      continue;
    }
    const matchesExpectedBadState = row.first_name === c.expectedCurrentFirstName && row.last_name === c.expectedCurrentLastName;
    if (!matchesExpectedBadState) {
      console.log(`SKIP ${c.email} — current name ("${row.first_name} ${row.last_name}") doesn't match what the investigation expected ("${c.expectedCurrentFirstName} ${c.expectedCurrentLastName}"). Refusing to overwrite blind — re-check manually.`);
      continue;
    }
    console.log(`FIX  ${c.email} — "${row.first_name} ${row.last_name}" -> "${c.correctFirstName} ${c.correctLastName}"`);
    toFix.push(c);
  }

  if (toFix.length === 0) {
    console.log('\nNothing to fix.');
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(OUT_DIR, `test_data_name_fix_${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(toFix.map((c) => ({ ...c, before: byId.get(c.registrantId) })), null, 2));
  console.log(`\nBacked up current state of ${toFix.length} row(s) -> ${backupPath}`);

  if (!apply) {
    console.log('\nRe-run with --apply to actually update.');
    return;
  }

  for (const c of toFix) {
    const row = byId.get(c.registrantId)!;
    const { error: updateError } = await supabase
      .schema('registry')
      .from('registrants')
      .update({ first_name: c.correctFirstName, last_name: c.correctLastName })
      .eq('id', c.registrantId);
    if (updateError) throw updateError;

    const edits = [];
    if (row.first_name !== c.correctFirstName) {
      edits.push({ registrant_id: c.registrantId, field: 'first_name', old_value: row.first_name, new_value: c.correctFirstName, edited_by: editorUser.id, edited_by_email: EDITOR_EMAIL });
    }
    if (row.last_name !== c.correctLastName) {
      edits.push({ registrant_id: c.registrantId, field: 'last_name', old_value: row.last_name, new_value: c.correctLastName, edited_by: editorUser.id, edited_by_email: EDITOR_EMAIL });
    }
    if (edits.length > 0) {
      const { error: editError } = await supabase.schema('registry').from('registrant_edits').insert(edits);
      if (editError) throw editError;
    }
    console.log(`  updated ${c.email} + logged ${edits.length} registrant_edits row(s).`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
