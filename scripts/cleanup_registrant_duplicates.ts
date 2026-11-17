/**
 * One-off — cleans up duplicate / malformed rows in registry.registrants
 * (2026-11-17, Lorraine reported duplicates). Root cause and rules are in
 * lib/registryPipeline/duplicateCleanupPlan.ts: the September CSV reload
 * copied emails verbatim, including a trailing spreadsheet footnote digit
 * ("a@b.com    1") and stray spaces, so the same person could exist twice
 * under two "different" email strings.
 *
 *  1. MERGE  — certain duplicates (same cleaned email + name, or an
 *     email-less row with the same phone + name). The survivor keeps its own
 *     values and only has blanks filled in; Unsubscribed / NFC "Yes" always
 *     wins. The loser's registration_events, whatsapp_invite_log and
 *     registrant_edits rows are moved to the survivor, then the loser is
 *     deleted.
 *  2. EMAIL FIX — a dirty email that collides with nobody. Footnote digit /
 *     case / outer whitespace are applied by default; spaces *inside* an
 *     address ("laurie. msc@gmail.com") are a guess, applied only with
 *     --include-guessed-emails.
 *  3. Never touched: couples sharing an address (different names), and
 *     same-name + same-phone rows with different emails — those go into a
 *     review CSV for Lorraine to decide.
 *
 * SAFETY:
 *  - Dry run by default: prints the plan, writes nothing to the database.
 *  - Always writes to backups/ (gitignored) before any write: the plan, the
 *    full before-state of every row it would touch, the dependent rows being
 *    moved, and the review CSV.
 *  - Idempotent: the plan is recomputed from live data at --apply time.
 *  - Every email repair and survivor field change is logged to
 *    registry.registrant_edits (run scripts/add_email_and_church_to_registrant_edits_check.sql
 *    first, or the audit inserts are rejected — the data changes still
 *    happen, and the script says so).
 *
 * Usage:
 *   npx tsx scripts/cleanup_registrant_duplicates.ts                          # dry run
 *   npx tsx scripts/cleanup_registrant_duplicates.ts --apply
 *   npx tsx scripts/cleanup_registrant_duplicates.ts --apply --include-guessed-emails
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import {
  planDuplicateCleanup,
  type DedupRegistrant,
  type DuplicateCleanupPlan,
  type MergePlan,
} from '../lib/registryPipeline/duplicateCleanupPlan';

const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const includeGuessed = args.includes('--include-guessed-emails');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const PAGE_SIZE = 1000;
const OUT_DIR = path.join(__dirname, '..', 'backups');
// national_admin attributed on the registrant_edits rows (same as
// scripts/restore_missing_registrants_from_sheet.ts).
const EDITOR_USER_ID = '6806baba-b978-4000-9a20-eabcca27386f';
const EDITOR_EMAIL = 'plvmx01@gmail.com';
// Fields the audit table's CHECK constraint allows (besides 'email').
const AUDITED_FIELDS = new Set(['first_name', 'last_name', 'state', 'postcode', 'nfc', 'church_name']);

const COLUMNS = 'id, first_name, last_name, email, phone, phone_raw, ac_contact_id, registered_at, state, postcode, church_name, church_leader, interested_in_training, webinar_session_at, webinar_attended, code_of_conduct_agreed, code_of_conduct_agreed_at, unsubscribed, nfc';

async function fetchAllRegistrants(): Promise<DedupRegistrant[]> {
  const out: DedupRegistrant[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .schema('registry')
      .from('registrants')
      .select(COLUMNS)
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as unknown as DedupRegistrant[]));
    if (data.length < PAGE_SIZE) break;
  }
  return out;
}

const label = (r: DedupRegistrant | undefined) =>
  r ? `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || '(no name)' : '?';

function printPlan(plan: DuplicateCleanupPlan, byId: Map<string, DedupRegistrant>) {
  const safe = plan.emailFixes.filter((f) => f.risk === 'safe');
  const guessed = plan.emailFixes.filter((f) => f.risk === 'review');
  console.log('\n=== SUMMARY ===');
  console.log(`  MERGES (certain duplicates; rows to delete: ${plan.merges.reduce((n, m) => n + m.loserIds.length, 0)}): ${plan.merges.length}`);
  console.log(`  EMAIL FIXES — safe (footnote digit / case / outer spaces): ${safe.length}`);
  console.log(`  EMAIL FIXES — guessed (spaces inside the address)${includeGuessed ? ' [WILL BE APPLIED]' : ' [not applied without --include-guessed-emails]'}: ${guessed.length}`);
  console.log(`  Shared address, different people (left alone): ${plan.sharedEmailLeftAlone.length}`);
  console.log(`  Unrepairable emails (left alone): ${plan.unfixable.length}`);
  console.log(`  Same name + phone, different emails (review CSV): ${plan.reviewPairs.length}`);

  console.log('\n=== MERGES ===');
  for (const m of plan.merges) {
    const s = byId.get(m.survivorId);
    console.log(`  [${m.reason}] keep ${label(s)} <${s?.email ?? '—'}> (${m.survivorId})`);
    for (const id of m.loserIds) console.log(`      remove <${byId.get(id)?.email ?? '—'}> (${id})`);
    if (Object.keys(m.updates).length) console.log(`      fill: ${JSON.stringify(m.updates)}`);
    if (m.emailChange) console.log(`      email: "${m.emailChange.from}" -> "${m.emailChange.to}"`);
    m.conflicts.forEach((c) => console.log(`      conflict — ${c}`));
  }
  console.log('\n=== EMAIL FIXES ===');
  for (const f of plan.emailFixes) console.log(`  ${f.risk === 'review' ? '[guessed] ' : ''}${label(byId.get(f.registrantId)).padEnd(28)} "${f.from}" -> "${f.to}"`);
  console.log('\n=== UNREPAIRABLE EMAILS ===');
  plan.unfixable.forEach((u) => console.log(`  ${label(byId.get(u.registrantId))}: "${u.rawEmail}"`));
}

const csvCell = (v: string | null) => `"${(v ?? '').replace(/"/g, '""')}"`;

function reviewCsv(plan: DuplicateCleanupPlan): string {
  const lines = ['Name,Mobile,Email,Registered,State,Registry id'];
  for (const p of plan.reviewPairs) {
    for (const r of p.rows) lines.push([p.name, p.phone, r.email, r.registeredAt?.slice(0, 10) ?? null, r.state, r.id].map(csvCell).join(','));
    lines.push('');
  }
  return lines.join('\n');
}

async function audit(rows: { registrant_id: string; field: string; old_value: string | null; new_value: string | null }[]) {
  if (rows.length === 0) return;
  const { error } = await supabase
    .schema('registry')
    .from('registrant_edits')
    .insert(rows.map((r) => ({ ...r, edited_by: EDITOR_USER_ID, edited_by_email: EDITOR_EMAIL })));
  if (error) console.log(`    (audit log insert failed — ${error.message}; has the CHECK-constraint SQL been run?)`);
}

async function applyMerge(m: MergePlan, byId: Map<string, DedupRegistrant>) {
  const survivor = byId.get(m.survivorId)!;
  if (Object.keys(m.updates).length) {
    const { error } = await supabase.schema('registry').from('registrants').update(m.updates).eq('id', m.survivorId);
    if (error) throw error;
    await audit(
      Object.entries(m.updates)
        .filter(([f]) => AUDITED_FIELDS.has(f))
        .map(([f, v]) => ({ registrant_id: m.survivorId, field: f, old_value: (survivor as unknown as Record<string, string | null>)[f] ?? null, new_value: v })),
    );
  }
  for (const table of ['registration_events', 'whatsapp_invite_log', 'registrant_edits']) {
    const { error } = await supabase.schema('registry').from(table).update({ registrant_id: m.survivorId }).in('registrant_id', m.loserIds);
    if (error) throw error;
  }
  const { error: delError } = await supabase.schema('registry').from('registrants').delete().in('id', m.loserIds);
  if (delError) throw delError;
  if (m.emailChange) {
    // After the delete: the unique index on email could otherwise collide with the loser's row.
    const { error } = await supabase.schema('registry').from('registrants').update({ email: m.emailChange.to }).eq('id', m.survivorId);
    if (error) throw error;
    await audit([{ registrant_id: m.survivorId, field: 'email', old_value: m.emailChange.from, new_value: m.emailChange.to }]);
  }
}

async function main() {
  const registrants = await fetchAllRegistrants();
  console.log(`Registry holds ${registrants.length} registrants.`);
  const byId = new Map(registrants.map((r) => [r.id, r]));
  const plan = planDuplicateCleanup(registrants);
  printPlan(plan, byId);

  const fixes = plan.emailFixes.filter((f) => includeGuessed || f.risk === 'safe');
  const touched = new Set<string>([...plan.merges.flatMap((m) => [m.survivorId, ...m.loserIds]), ...fixes.map((f) => f.registrantId)]);
  const loserIds = plan.merges.flatMap((m) => m.loserIds);
  const dependents: Record<string, unknown> = {};
  if (loserIds.length) {
    for (const table of ['registration_events', 'whatsapp_invite_log', 'registrant_edits']) {
      const { data, error } = await supabase.schema('registry').from(table).select('*').in('registrant_id', loserIds);
      if (error) throw error;
      dependents[table] = data;
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(OUT_DIR, `cleanup_registrant_duplicates_${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ plan, fixesToApply: fixes, rowsBefore: [...touched].map((id) => byId.get(id)), loserDependents: dependents }, null, 2));
  const csvPath = path.join(OUT_DIR, `registrant_duplicate_review_${stamp}.csv`);
  fs.writeFileSync(csvPath, reviewCsv(plan));
  console.log(`\nBackup -> ${backupPath}\nReview list for Lorraine (${plan.reviewPairs.length} groups) -> ${csvPath}`);

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to write.');
    return;
  }

  console.log('\nApplying merges...');
  let merged = 0;
  for (const m of plan.merges) {
    try {
      await applyMerge(m, byId);
      merged += m.loserIds.length;
    } catch (err) {
      console.log(`  FAILED merge into ${m.survivorId}: ${err instanceof Error ? err.message : JSON.stringify(err)} — skipped, others continue.`);
    }
  }
  console.log(`  removed ${merged} duplicate rows`);

  console.log('Applying email fixes...');
  let fixed = 0;
  for (const f of fixes) {
    const { data, error } = await supabase
      .schema('registry')
      .from('registrants')
      .update({ email: f.to })
      .eq('id', f.registrantId)
      .eq('email', f.from) // only if unchanged since the plan was made
      .select('id');
    if (error || !data?.length) {
      console.log(`  skipped ${f.registrantId} — ${error ? error.message : 'its email changed since the plan was made'}`);
      continue;
    }
    await audit([{ registrant_id: f.registrantId, field: 'email', old_value: f.from, new_value: f.to }]);
    fixed += 1;
  }
  console.log(`  repaired ${fixed} emails`);

  const after = await fetchAllRegistrants();
  console.log(`\nDone. Registry now holds ${after.length} registrants (was ${registrants.length}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
