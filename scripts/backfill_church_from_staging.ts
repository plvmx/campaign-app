/**
 * One-off — fills registry.registrants.church_name for registrants whose
 * church is blank only because ac-sync never read AC field [8] (the field the
 * current "AFJ Register Commitment" form writes the church to; fixed in
 * fieldMap.ts 2026-11-03). Recovers each church from that contact's most
 * recent saved payload in staging.ac_events — no AC API calls.
 *
 * Planning rules: lib/registryPipeline/churchBackfillPlan.ts (tested).
 *
 * SAFETY:
 *  - Dry run by default: prints counts + a sample, writes nothing.
 *  - FILLS ONLY: each update is guarded with `church_name IS NULL`, so it can
 *    never overwrite a church that is there (including one typed in since).
 *  - Backs the planned changes up to backups/ (gitignored) first.
 *  - Idempotent: a second run finds nothing left to fill.
 *  - `--since=YYYY-MM-DD` limits it to registrants first seen on/after that
 *    date (the form started writing [8] around 10 Sept 2026).
 *
 * Usage:
 *   npx tsx scripts/backfill_church_from_staging.ts                       # dry run, everyone
 *   npx tsx scripts/backfill_church_from_staging.ts --since=2026-09-10    # dry run, recent only
 *   npx tsx scripts/backfill_church_from_staging.ts --since=2026-09-10 --apply
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { planChurchBackfill, type BlankChurchRegistrant } from '../lib/registryPipeline/churchBackfillPlan';
import type { RawAcContactPayload } from '../lib/registryPipeline/types';

const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const since = args.find((a) => a.startsWith('--since='))?.slice('--since='.length) ?? null;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const PAGE_SIZE = 1000;
const CONTACT_CHUNK = 100;
const OUT_DIR = path.join(__dirname, '..', 'backups');

async function main() {
  const blank: BlankChurchRegistrant[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let q = supabase.schema('registry').from('registrants').select('id, email, ac_contact_id, first_seen_at')
      .not('ac_contact_id', 'is', null).is('church_name', null).order('id').range(offset, offset + PAGE_SIZE - 1);
    if (since) q = q.gte('first_seen_at', since);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    blank.push(...data.map((r) => ({ id: r.id as string, acContactId: r.ac_contact_id as string, email: r.email as string | null })));
    if (data.length < PAGE_SIZE) break;
  }
  console.log(`Registrants with an AC contact and a blank church${since ? ` (first seen since ${since})` : ''}: ${blank.length}`);

  // Latest saved payload per contact (events are read oldest -> newest, so the last one wins).
  const latest = new Map<string, RawAcContactPayload>();
  for (let i = 0; i < blank.length; i += CONTACT_CHUNK) {
    const ids = blank.slice(i, i + CONTACT_CHUNK).map((r) => r.acContactId);
    const { data, error } = await supabase.schema('staging').from('ac_events').select('id, ac_contact_id, raw_payload').in('ac_contact_id', ids).order('id');
    if (error) throw error;
    for (const e of data ?? []) latest.set(e.ac_contact_id as string, e.raw_payload as RawAcContactPayload);
  }

  const updates = planChurchBackfill(blank, latest);
  console.log(`Churches that can be filled from saved AC data: ${updates.length}`);
  console.log(`Still blank afterwards (AC has none either): ${blank.length - updates.length}`);
  console.log('Sample:', updates.slice(0, 5).map((u) => `${u.email} -> ${u.churchName}`));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const backupPath = path.join(OUT_DIR, `church_backfill_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(updates, null, 2));
  console.log(`Backed up the planned changes -> ${backupPath}`);

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to write.');
    return;
  }

  let written = 0;
  for (const u of updates) {
    const { data, error } = await supabase.schema('registry').from('registrants')
      .update({ church_name: u.churchName }).eq('id', u.registrantId).is('church_name', null).select('id');
    if (error) throw error;
    written += data?.length ?? 0;
  }
  console.log(`\nDone. Filled ${written} of ${updates.length} (the rest changed since the plan was made).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
